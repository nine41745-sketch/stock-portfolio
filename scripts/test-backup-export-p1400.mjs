import assert from 'node:assert/strict'
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { test } from 'node:test'
import { generateIdentity, identityToRecipient } from 'age-encryption'
import { createEncryptedBackupSet, restoreEncryptedBackupSet, verifyEncryptedBackupSet } from './backup/encrypted-set.mjs'
import { buildPublicRoleDependenciesScript } from './backup/public-role-dependencies.mjs'
import { buildPostgresDumpArguments, buildPostgresRolesArguments, buildPublicSchemaAclScript, createPostgresBackupStreams } from './backup/postgres-streams.mjs'

const fixture = async () => {
  const root = await mkdtemp(join(process.cwd(), '.test-backup-export-p1400-'))
  const primaryIdentity = await generateIdentity()
  const recoveryIdentity = await generateIdentity()
  const recipients = [await identityToRecipient(primaryIdentity), await identityToRecipient(recoveryIdentity)]
  const source = {
    projectRef: 'synthetic-project',
    schema: 'public',
    capturedAt: '2026-10-19T00:00:00.000Z',
    pgDumpVersion: 'pg_dump (PostgreSQL) 17.11 synthetic',
    psqlVersion: 'psql (PostgreSQL) 17.11 synthetic',
    serverVersion: 'NOT_QUERIED',
    rolesDumpVersion: 'pg_dumpall (PostgreSQL) 17.11 synthetic',
    snapshot: 'pg_dump single-database snapshot; cluster globals are a separate export',
  }
  const components = [
    { name: 'database-public', stream: Readable.from([Buffer.from('SYNTHETIC-DATABASE-HEADER\n'), Buffer.alloc(256 * 1024, 0x5a)]) },
    { name: 'public-role-dependencies', stream: Readable.from([Buffer.from('SYNTHETIC-ROLE;\n')]) },
    { name: 'public-schema-acl', stream: Readable.from([Buffer.from('BEGIN; GRANT USAGE ON SCHEMA public TO PUBLIC; COMMIT;\n')]) },
  ]
  return { root, primaryIdentity, recoveryIdentity, recipients, source, components }
}

const collect = () => {
  const chunks = []
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } })
  return { sink, result: () => Buffer.concat(chunks) }
}

test('streams an age-encrypted complete set and restores through the recovery recipient', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  const setPath = join(f.root, 'set-001')
  const created = await createEncryptedBackupSet({ destination: f.root, setName: 'set-001', recipients: f.recipients, source: f.source, components: f.components })
  assert.equal(created.setPath, setPath)
  const names = (await readdir(setPath)).sort()
  assert.deepEqual(names, ['data-key.age', 'database-public.dump.aes256gcm', 'manifest.json.age', 'public-role-dependencies.sql.aes256gcm', 'public-schema-acl.sql.aes256gcm'])
  for (const name of names) {
    const bytes = await readFile(join(setPath, name))
    assert.equal(bytes.includes(Buffer.from('SYNTHETIC-DATABASE-HEADER')), false, 'persistent artifact must not contain synthetic plaintext')
    assert.equal(bytes.includes(Buffer.from('SYNTHETIC-ROLE')), false, 'persistent artifact must not contain role plaintext')
  }
  const verification = await verifyEncryptedBackupSet({ setPath, identities: [f.recoveryIdentity], expectedProjectRef: 'synthetic-project' })
  assert.equal(verification.result, 'VERIFIED')
  assert.equal(verification.components.length, 3)
  assert.equal(verification.coverage.supabaseAuth, 'NOT_EXPORTED')
  const recoveryCopy = join(f.root, 'recovery-copy')
  await mkdir(recoveryCopy)
  for (const name of names) await copyFile(join(setPath, name), join(recoveryCopy, name))
  assert.equal((await verifyEncryptedBackupSet({ setPath: recoveryCopy, identities: [f.recoveryIdentity], expectedProjectRef: 'synthetic-project' })).result, 'VERIFIED')
  const outputs = new Map()
  await restoreEncryptedBackupSet({
    setPath,
    identities: [f.recoveryIdentity],
    expectedProjectRef: 'synthetic-project',
    beginRestore: async () => ({
      createSink: name => { const output=collect();outputs.set(name,output);return output.sink },
      commit: async () => {},
      rollback: async () => { throw new Error('unexpected rollback') },
    }),
  })
  assert.deepEqual([...outputs.keys()], ['public-role-dependencies','database-public','public-schema-acl'], 'Role prerequisites must complete before the database restore sink opens')
  assert.equal(outputs.get('database-public').result().length, 256 * 1024 + Buffer.byteLength('SYNTHETIC-DATABASE-HEADER\n'))
  assert.equal(outputs.get('database-public').result().subarray(0, 26).toString(), 'SYNTHETIC-DATABASE-HEADER\n')
  assert.equal(outputs.get('public-role-dependencies').result().toString(), 'SYNTHETIC-ROLE;\n')
  assert.match(outputs.get('public-schema-acl').result().toString(), /SCHEMA public/)
})

test('rejects an identity that is not one of the declared recovery recipients', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  const other = await generateIdentity()
  await createEncryptedBackupSet({ destination: f.root, setName: 'wrong-key', recipients: f.recipients, source: f.source, components: f.components })
  await assert.rejects(verifyEncryptedBackupSet({ setPath: join(f.root, 'wrong-key'), identities: [other], expectedProjectRef: 'synthetic-project' }))
})

test('detects component ciphertext tampering before restore opens a sink', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  const setPath = join(f.root, 'tampered-component')
  await createEncryptedBackupSet({ destination: f.root, setName: 'tampered-component', recipients: f.recipients, source: f.source, components: f.components })
  const artifact = join(setPath, 'database-public.dump.aes256gcm')
  const bytes = await readFile(artifact)
  bytes[Math.floor(bytes.length / 2)] ^= 1
  await writeFile(artifact, bytes)
  let sinkRequested = false
  await assert.rejects(restoreEncryptedBackupSet({
    setPath,
    identities: [f.primaryIdentity],
    expectedProjectRef: 'synthetic-project',
    beginRestore: async () => { sinkRequested = true; return {} },
  }))
  assert.equal(sinkRequested, false)
})

test('rejects an existing destination without changing its contents', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  const target = join(f.root, 'existing')
  await mkdir(target)
  const sentinel = join(target, 'owner-file.txt')
  await writeFile(sentinel, 'preserve')
  await assert.rejects(createEncryptedBackupSet({ destination: f.root, setName: 'existing', recipients: f.recipients, source: f.source, components: f.components }))
  assert.equal(await readFile(sentinel, 'utf8'), 'preserve')
  assert.deepEqual((await readdir(f.root)).sort(), ['existing'])
})

test('rejects missing, duplicated, and unknown components before publishing a set', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  const valid = f.components[0]
  for (const [setName, components] of [
    ['missing', []],
    ['duplicate', [valid, { ...valid, stream: Readable.from([Buffer.from('duplicate')]) }]],
    ['unknown', [valid, { name: 'unexpected', stream: Readable.from([Buffer.from('unexpected')]) }]],
  ]) {
    await assert.rejects(createEncryptedBackupSet({ destination: f.root, setName, recipients: f.recipients, source: f.source, components }))
    assert.equal((await readdir(f.root)).includes(setName), false)
  }
})

test('cleans only its exclusive staging directory after an interrupted component stream', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  const broken = Readable.from((async function* () { yield Buffer.from('partial synthetic stream'); throw new Error('synthetic source failure') })())
  await assert.rejects(createEncryptedBackupSet({
    destination: f.root,
    setName: 'interrupted',
    recipients: f.recipients,
    source: f.source,
    components: [
      { name: 'database-public', stream: Readable.from([Buffer.from('complete synthetic dump')]) },
      { name: 'public-role-dependencies', stream: broken },
      f.components[2],
    ],
  }))
  assert.deepEqual(await readdir(f.root), [])
})

test('applies a bounded stream deadline and publishes no partial set on timeout', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  const stalled = new Readable({ read() {} })
  await assert.rejects(createEncryptedBackupSet({
    destination: f.root,
    setName: 'stalled-source',
    recipients: f.recipients,
    source: f.source,
    components: [f.components[0], f.components[1], { name: 'public-schema-acl', stream: stalled }],
    timeoutMs: 500,
  }), /Encrypted stream generation failed|AES-256-GCM component encryption failed/)
  assert.deepEqual(await readdir(f.root), [])
})

test('detects truncated encrypted files and mismatched source identity', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  const setPath = join(f.root, 'truncated')
  await createEncryptedBackupSet({ destination: f.root, setName: 'truncated', recipients: f.recipients, source: f.source, components: f.components })
  const artifact = join(setPath, 'public-role-dependencies.sql.aes256gcm')
  const bytes = await readFile(artifact)
  await writeFile(artifact, bytes.subarray(0, bytes.length - 7))
  await assert.rejects(verifyEncryptedBackupSet({ setPath, identities: [f.primaryIdentity], expectedProjectRef: 'synthetic-project' }))
  await assert.rejects(verifyEncryptedBackupSet({ setPath, identities: [f.primaryIdentity], expectedProjectRef: 'different-synthetic-project' }))
})

test('refuses unexpected files and malformed source paths', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  await assert.rejects(createEncryptedBackupSet({ destination: f.root, setName: '../escape', recipients: f.recipients, source: f.source, components: f.components }))
  const setPath = join(f.root, 'unexpected')
  await createEncryptedBackupSet({ destination: f.root, setName: 'unexpected', recipients: f.recipients, source: f.source, components: f.components })
  await writeFile(join(setPath, 'unexpected.txt'), 'not owned')
  await assert.rejects(verifyEncryptedBackupSet({ setPath, identities: [f.primaryIdentity], expectedProjectRef: 'synthetic-project' }))
  assert.equal((await stat(join(setPath, 'unexpected.txt'))).isFile(), true)
})

test('streams a large synthetic component without materializing a backup-sized input buffer', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  const chunk = Buffer.alloc(64 * 1024, 0x33)
  const chunks = 192
  const stream = Readable.from((async function* () { for (let index = 0; index < chunks; index += 1) yield chunk })(), { objectMode: false, highWaterMark: 64 * 1024 })
  await createEncryptedBackupSet({ destination: f.root, setName: 'large-stream', recipients: f.recipients, source: f.source, components: [{ name: 'database-public', stream }, f.components[1], f.components[2]] })
  const verified = await verifyEncryptedBackupSet({ setPath: join(f.root, 'large-stream'), identities: [f.primaryIdentity], expectedProjectRef: 'synthetic-project' })
  assert.equal(verified.components[0].bytes, chunks * chunk.length)
})

test('age-authenticated manifest corruption is rejected before a restore sink is created', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  const setPath = join(f.root, 'bad-manifest')
  await createEncryptedBackupSet({ destination: f.root, setName: 'bad-manifest', recipients: f.recipients, source: f.source, components: f.components })
  const manifest = join(setPath, 'manifest.json.age')
  const bytes = await readFile(manifest)
  bytes[bytes.length - 2] ^= 0x80
  await writeFile(manifest, bytes)
  let sinkRequested = false
  await assert.rejects(restoreEncryptedBackupSet({
    setPath,
    identities: [f.primaryIdentity],
    expectedProjectRef: 'synthetic-project',
    beginRestore: async () => { sinkRequested = true; return {} },
  }))
  assert.equal(sinkRequested, false)
})

test('rolls back a disposable target if restore streaming fails after another component was written', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  const setPath = join(f.root, 'restore-failure')
  await createEncryptedBackupSet({ destination: f.root, setName: 'restore-failure', recipients: f.recipients, source: f.source, components: f.components })
  const output = new Map()
  let committed = false, rolledBack = false
  await assert.rejects(restoreEncryptedBackupSet({
    setPath,
    identities: [f.primaryIdentity],
    expectedProjectRef: 'synthetic-project',
    beginRestore: async () => ({
      createSink(name) {
        if (name === 'public-schema-acl') return new Writable({ write(_chunk, _encoding, callback) { callback(new Error('synthetic restore sink failure')) } })
        const chunks = []
        output.set(name, chunks)
        return new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() } })
      },
      async commit() { committed = true },
      async rollback() { rolledBack = true; output.clear() },
    }),
  }))
  assert.equal(committed, false)
  assert.equal(rolledBack, true)
  assert.equal(output.size, 0)
})

test('PostgreSQL stream arguments select only public data and never pass a password', () => {
  const connection = { projectRef: 'abcdefghijklmnopqrst', host: 'db.abcdefghijklmnopqrst.supabase.co', port: 5432, database: 'postgres', username: 'backup_reader' }
  const dump = buildPostgresDumpArguments(connection, '00000001-00000002-1')
  assert.throws(() => buildPostgresRolesArguments(connection), /Global role export is disabled/)
  assert.ok(dump.includes('--schema=public'))
  assert.ok(dump.includes('--format=custom'))
  assert.ok(dump.includes('--no-password'))
  for (const args of [dump]) assert.equal(args.some(arg => /^--password$|password=|secret|token/i.test(arg)), false)
  assert.throws(() => buildPostgresDumpArguments({ ...connection, host: 'attacker.example' }))
})

test('PostgreSQL dump programs write to stdout and never receive a persistent output-file option', () => {
  const connection = { projectRef: 'abcdefghijklmnopqrst', host: 'db.abcdefghijklmnopqrst.supabase.co', port: 5432, database: 'postgres', username: 'backup_reader' }
  for (const args of [buildPostgresDumpArguments(connection, '00000001-00000002-1')]) {
    assert.equal(args.some(arg => /^--file(?:=|$)|^-f(?:$|.)/.test(arg)), false, 'dump output must remain on stdout')
  }
  assert.throws(() => buildPostgresDumpArguments(connection), /snapshot/i)
})

test('mock PostgreSQL child processes feed only the encrypted pipeline and leave no plaintext outputs', async t => {
  const root = await mkdtemp(join(process.cwd(), '.test-pg-stdout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'bin')
  await mkdir(bin)
  const mockProgram = join(root, 'mock-postgres.mjs')
  await writeFile(mockProgram, `
import { basename, resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
const executable = basename(process.argv[2])
const args = process.argv.slice(3)
const tool = executable.startsWith('pg_dumpall') ? 'pg_dumpall' : executable.startsWith('pg_dump') ? 'pg_dump' : 'psql'
if (args[0] === '--version') { process.stdout.write(tool + ' (PostgreSQL) 17.11\\n'); process.exit(0) }
const outputOption = args.findIndex(arg => arg === '--file' || arg === '-f')
const outputEquals = args.find(arg => arg.startsWith('--file='))
const outputPath = outputEquals ? outputEquals.slice('--file='.length) : outputOption >= 0 ? args[outputOption + 1] : null
if (outputPath !== null) writeFileSync(resolve(outputPath), tool === 'pg_dumpall' ? 'SYNTHETIC_ROLE_PLAINTEXT' : 'SYNTHETIC_DUMP_PLAINTEXT')
else if (tool === 'psql' && !args.includes('--command')) {
  let input = ''
  let emitted = false
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    input += chunk
    const marker = input.match(/\\\\echo (SP_SNAPSHOT_READY_[A-Fa-f0-9]+__)/)?.[1]
    if (marker && !emitted) {
      emitted = true
      process.stdout.write('00000001-00000002-1\\n' + marker + '\\n')
    }
    if (input.includes('\\\\q')) process.exit(0)
  })
  process.stdin.on('end', () => process.exit(0))
}
else if (tool === 'psql' && executable.includes('.fail')) { process.stdout.write('SYNTHETIC_FAILED_PARTIAL'); process.exit(7) }
else if (tool === 'psql' && executable.includes('.interrupt')) { process.stdout.write('SYNTHETIC_INTERRUPTED_PARTIAL'); process.exit(9) }
else if (tool === 'psql' && executable.includes('.timeout')) { process.stdout.write('SYNTHETIC_TIMEOUT_PARTIAL'); setInterval(() => {}, 1000) }
else if (tool === 'pg_dump') process.stdout.write('SYNTHETIC_DUMP_PLAINTEXT')
else if (tool === 'pg_dumpall') process.exit(91)
else if (args.at(-1).includes('owners_and_acls')) process.stdout.write(JSON.stringify({version:1,schema:'public',roles:['pg_database_owner'],globalDefaults:false,unsupportedDependencies:false}))
else process.stdout.write(JSON.stringify([{grantee:null,grantor:'pg_database_owner',privilege:'USAGE',grantable:false}]))
`)
  const expectedRootEntries = new Set(['mock-postgres.mjs', 'bin', 'encrypted-success'])
  const expectedBinEntries = new Set()
  const makeConfig = async suffix => {
    const paths = {
      pgDumpPath: join(bin, `pg_dump${suffix}.mock`),
      psqlPath: join(bin, `psql${suffix}.mock`),
      pgPassfile: join(root, 'pgpass.synthetic'),
      sslRootCert: join(root, 'ca.synthetic'),
    }
    for (const path of Object.values(paths)) {
      await writeFile(path, 'synthetic test fixture')
      if (dirname(path) === bin) expectedBinEntries.add(path.slice(bin.length + 1))
      else expectedRootEntries.add(path.slice(root.length + 1))
    }
    return {
      projectRef: 'abcdefghijklmnopqrst', host: 'db.abcdefghijklmnopqrst.supabase.co', port: 5432,
      database: 'postgres', username: 'backup_reader', timeoutMs: suffix.includes('timeout') ? 1500 : 3000,
      ...paths,
    }
  }
  const invoke = (config, calls) => (executable, args, options) => {
    calls.push({ executable, args })
    return spawn(process.execPath, [mockProgram, executable, ...args], { ...options, cwd: root })
  }
  const identity = await generateIdentity()
  const recipients = [await identityToRecipient(identity)]
  const source = { projectRef: 'abcdefghijklmnopqrst', schema: 'public', capturedAt: '2026-10-19T00:00:00.000Z', pgDumpVersion: 'unused', psqlVersion: 'unused', serverVersion: 'NOT_QUERIED', rolesDumpVersion: 'unused', snapshot: 'synthetic' }

  const successCalls = []
  const successConfig = await makeConfig('.success')
  const successful = await createPostgresBackupStreams(successConfig, { spawnProcess: invoke(successConfig, successCalls) })
  const setPath = join(root, 'encrypted-success')
  try {
    await createEncryptedBackupSet({ destination: root, setName: 'encrypted-success', recipients, source: { ...source, ...successful.source }, components: successful.components })
  } finally { await successful.close() }
  assert.equal((await verifyEncryptedBackupSet({ setPath, identities: [identity], expectedProjectRef: source.projectRef })).result, 'VERIFIED')
  assert.equal(await stat(join(root, '-')).then(() => true, () => false), false)
  for (const name of await readdir(setPath)) {
    const bytes = await readFile(join(setPath, name))
    assert.equal(bytes.includes(Buffer.from('SYNTHETIC_DUMP_PLAINTEXT')), false)
    assert.equal(bytes.includes(Buffer.from('SYNTHETIC_ROLE_PLAINTEXT')), false)
  }
  assert.ok(successCalls.some(call => call.executable.includes('pg_dump.success') && !call.args.some(arg => /^--file(?:=|$)|^-f(?:$|.)/.test(arg))))
  assert.equal(successCalls.some(call => call.executable.includes('pg_dumpall')), false)
  assert.ok(successCalls.some(call => call.executable.includes('psql.success') && call.args.at(-1).includes('owners_and_acls')))
  assert.deepEqual((await readdir(root)).sort(), [...expectedRootEntries].sort())
  assert.deepEqual((await readdir(bin)).sort(), [...expectedBinEntries].sort())

  for (const mode of ['fail', 'interrupt', 'timeout']) {
    const calls = []
    const config = await makeConfig(`.${mode}`)
    const streams = await createPostgresBackupStreams(config, { spawnProcess: invoke(config, calls) })
    try {
      await assert.rejects(createEncryptedBackupSet({
        destination: root, setName: `encrypted-${mode}`, recipients,
        source: { ...source, ...streams.source }, components: streams.components,
      }), undefined, `${mode} child process must fail closed`)
    } finally { await streams.close().catch(() => {}) }
    assert.equal(await stat(join(root, '-')).then(() => true, () => false), false, `${mode} must not create a dash-named plaintext file`)
    assert.equal(await stat(join(root, `encrypted-${mode}`)).then(() => true, () => false), false, `${mode} must not publish an incomplete backup set`)
    assert.deepEqual((await readdir(root)).sort(), [...expectedRootEntries].sort(), `${mode} must not persist output outside owned fixtures and staging`)
    assert.deepEqual((await readdir(bin)).sort(), [...expectedBinEntries].sort(), `${mode} must not write under the mock executable directory`)
  }
})

test('public schema ACL serializer preserves granted roles safely and rejects untrusted ACL fields', () => {
  const script=buildPublicSchemaAclScript([
    {grantee:null,grantor:'pg_database_owner',privilege:'USAGE',grantable:false},
    {grantee:'backup_reader',grantor:'pg_database_owner',privilege:'CREATE',grantable:true},
  ])
  assert.match(script,/GRANT USAGE ON SCHEMA public TO PUBLIC;/)
  assert.match(script,/GRANT CREATE ON SCHEMA public TO "backup_reader" WITH GRANT OPTION;/)
  assert.match(script,/SET LOCAL ROLE "pg_database_owner";/)
  assert.throws(()=>buildPublicSchemaAclScript([{grantee:'x',grantor:'owner',privilege:'DROP',grantable:false}]))
  assert.throws(()=>buildPublicSchemaAclScript([{grantee:'x; SELECT 1',grantor:'owner',privilege:'USAGE',grantable:false}]))
  assert.throws(()=>buildPublicSchemaAclScript([{grantee:'bad\nrole',grantor:'owner',privilege:'USAGE',grantable:false}]))
})

test('global role export is rejected even when role passwords are omitted', () => {
  const connection = { projectRef: 'abcdefghijklmnopqrst', host: 'db.abcdefghijklmnopqrst.supabase.co', port: 5432, database: 'postgres', username: 'backup_reader' }
  assert.throws(() => buildPostgresRolesArguments(connection), /Global role export is disabled/)
})

const dependencyEvidence = (patch = {}) => ({ version: 1, schema: 'public', roles: ['authenticated','pg_database_owner'], globalDefaults: false, unsupportedDependencies: false, ...patch })

test('scoped dependencies contain only existence guards and never define or elevate roles', () => {
  const sql = buildPublicRoleDependenciesScript(dependencyEvidence())
  assert.match(sql, /rolname = 'authenticated'/)
  assert.match(sql, /rolname = 'pg_database_owner'/)
  assert.doesNotMatch(sql, /CREATE ROLE|ALTER ROLE|GRANT .* TO|PASSWORD|BYPASSRLS|SUPERUSER|unrelated_private/i)
  assert.match(sql, /RAISE EXCEPTION/)
})

test('dependencies reject unknown, secret, privilege and out-of-scope fields without serializing them', () => {
  for (const patch of [{schema:'auth'}, {password:'synthetic'}, {rolsuper:true}, {memberships:[]}, {globalDefaults:true}, {unsupportedDependencies:true}, {roles:[]}, {roles:['one','one']}, {roles:Array.from({length:513},(_,i)=>'r'+i)}]) {
    assert.throws(() => buildPublicRoleDependenciesScript(dependencyEvidence(patch)))
  }
})

test('unsupported role identifiers fail closed in both dependency and schema ACL serializers', () => {
  for (const name of ['bad\nrole', 'x;DROP ROLE x', 'odd"role', "quote'role", 'back\\slash', '$sp_public_roles$', '', 'x'.repeat(64), 123, null]) {
    assert.throws(() => buildPublicRoleDependenciesScript(dependencyEvidence({roles:[name]})))
    if (name !== null) assert.throws(() => buildPublicSchemaAclScript([{grantee:name,grantor:'owner',privilege:'USAGE',grantable:false}]))
  }
})

test('an explicitly empty public schema ACL revokes PUBLIC rather than inventing grants', () => {
  assert.equal(buildPublicSchemaAclScript([]), 'BEGIN;\nREVOKE ALL ON SCHEMA public FROM PUBLIC;\nCOMMIT;\n')
})

test('legacy global-role component contracts fail before any artifact is written', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, {recursive:true,force:true}))
  f.components[1].name = 'roles-global'
  await assert.rejects(createEncryptedBackupSet({destination:f.root,setName:'legacy',recipients:f.recipients,source:f.source,components:f.components}))
  assert.deepEqual(await readdir(f.root), [])
})

test('failed dependency guard rolls back without opening a database restore sink', async t => {
  const f = await fixture()
  t.after(() => rm(f.root, {recursive:true,force:true}))
  const setName='missing-target-role'
  await createEncryptedBackupSet({destination:f.root,setName,recipients:f.recipients,source:f.source,components:f.components})
  const opened=[]
  let rolledBack=false
  await assert.rejects(restoreEncryptedBackupSet({
    setPath:join(f.root,setName), identities:[f.primaryIdentity], expectedProjectRef:'synthetic-project',
    beginRestore:async()=>({
      createSink(name){opened.push(name);return new Writable({write(_chunk,_enc,cb){cb(new Error('required synthetic target role missing'))}})},
      async commit(){assert.fail('must not commit')}, async rollback(){rolledBack=true},
    }),
  }))
  assert.deepEqual(opened,['public-role-dependencies'])
  assert.equal(rolledBack,true)
})

test('all PostgreSQL consumers import one exported snapshot and coordinator closes only after encrypted consumption', async t => {
  const root = await mkdtemp(join(process.cwd(), '.test-pg-snapshot-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'bin')
  await mkdir(bin)
  const mockProgram = join(root, 'mock-snapshot-postgres.mjs')
  const lifecyclePath = join(root, 'coordinator-closed')
  await writeFile(mockProgram, `
import { basename } from 'node:path'
import { writeFileSync } from 'node:fs'
const executable = basename(process.argv[2])
const args = process.argv.slice(3)
const tool = executable.startsWith('pg_dump') ? 'pg_dump' : 'psql'
if (args[0] === '--version') { process.stdout.write(tool + ' (PostgreSQL) 17.11\\n'); process.exit(0) }
if (tool === 'psql' && !args.includes('--command')) {
  let input = ''
  let emitted = false
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    input += chunk
    const marker = input.match(/\\\\echo (SP_SNAPSHOT_READY_[A-Fa-f0-9]+__)/)?.[1]
    if (marker && !emitted) {
      emitted = true
      process.stdout.write('00000001-00000002-1\\n' + marker + '\\n')
    }
    if (input.includes('\\\\q')) {
      writeFileSync(${JSON.stringify(lifecyclePath)}, 'closed')
      process.exit(0)
    }
  })
  process.stdin.on('end', () => process.exit(0))
} else if (tool === 'pg_dump') {
  process.stdout.write('SYNTHETIC-SNAPSHOT-DUMP')
} else {
  const command = args.at(-1)
  if (command.includes('owners_and_acls')) process.stdout.write(JSON.stringify({version:1,schema:'public',roles:['pg_database_owner'],globalDefaults:false,unsupportedDependencies:false}))
  else process.stdout.write(JSON.stringify([{grantee:null,grantor:'pg_database_owner',privilege:'USAGE',grantable:false}]))
}
`)
  const paths = {
    pgDumpPath: join(bin, 'pg_dump.mock'), psqlPath: join(bin, 'psql.mock'),
    pgPassfile: join(root, 'pgpass.synthetic'), sslRootCert: join(root, 'ca.synthetic'),
  }
  for (const path of Object.values(paths)) await writeFile(path, 'synthetic test fixture')
  const config = {
    projectRef: 'abcdefghijklmnopqrst', host: 'db.abcdefghijklmnopqrst.supabase.co', port: 5432,
    database: 'postgres', username: 'backup_reader', timeoutMs: 3000, ...paths,
  }
  const calls = []
  const coordinatorChildren = []
  const spawnProcess = (executable, args, options) => {
    calls.push({ executable, args })
    const child = spawn(process.execPath, [mockProgram, executable, ...args], { ...options, cwd: root })
    if (executable === paths.psqlPath && !args.includes('--command')) coordinatorChildren.push(child)
    return child
  }
  const identity = await generateIdentity()
  const recipients = [await identityToRecipient(identity)]
  const streams = await createPostgresBackupStreams(config, { spawnProcess })
  assert.equal(await stat(lifecyclePath).then(() => true, () => false), false, 'coordinator must still be open after exporting the token')
  assert.match(streams.source.snapshot, /coordinated/i)
  assert.doesNotMatch(JSON.stringify(streams.source), /00000001-00000002-1/)
  const setPath = join(root, 'coordinated-set')
  try {
    await createEncryptedBackupSet({ destination: root, setName: 'coordinated-set', recipients, source: streams.source, components: streams.components })
    assert.equal(await stat(lifecyclePath).then(() => true, () => false), false, 'coordinator must remain open until every encrypted consumer completes')
    const dumpCall = calls.find(call => call.executable === paths.pgDumpPath && call.args[0] !== '--version')
    assert.ok(dumpCall.args.includes('--snapshot=00000001-00000002-1'))
    const queryCalls = calls.filter(call => call.executable === paths.psqlPath && call.args.includes('--command'))
    assert.equal(queryCalls.length, 2)
    for (const call of queryCalls) {
      const sql = call.args.at(-1)
      assert.match(sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/i)
      assert.match(sql, /SET TRANSACTION SNAPSHOT '00000001-00000002-1'/i)
      assert.ok(sql.indexOf('SET TRANSACTION SNAPSHOT') < sql.indexOf('SELECT'), 'snapshot import must precede catalog queries')
    }
  } finally {
    await streams.close()
  }
  assert.equal(await readFile(lifecyclePath, 'utf8'), 'closed')
  const verified = await verifyEncryptedBackupSet({ setPath, identities: [identity], expectedProjectRef: config.projectRef })
  assert.equal(verified.result, 'VERIFIED')
})

test('snapshot coordinator rejects invalid exports and reaps failed coordinators without exposing tokens', async t => {
  const root = await mkdtemp(join(process.cwd(), '.test-pg-snapshot-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'bin')
  await mkdir(bin)
  const mockProgram = join(root, 'mock-invalid-snapshot.mjs')
  await writeFile(mockProgram, `
import { basename } from 'node:path'
const executable = basename(process.argv[2])
const args = process.argv.slice(3)
const tool = executable.startsWith('pg_dump') ? 'pg_dump' : 'psql'
if (args[0] === '--version') { process.stdout.write(tool + ' (PostgreSQL) 17.11\\n'); process.exit(0) }
if (tool === 'psql' && !args.includes('--command')) {
  const mode = process.env.SYNTHETIC_COORDINATOR_MODE
  if (mode === 'early-exit') process.exit(9)
  if (mode === 'invalid') process.stdout.write('NOT_A_SNAPSHOT\\n')
  if (mode === 'secret-invalid') process.stdout.write('SYNTHETIC-SENSITIVE-TOKEN\\n')
  if (mode !== 'timeout') process.stdin.resume()
} else process.exit(0)
`)
  const paths = {
    pgDumpPath: join(bin, 'pg_dump.mock'), psqlPath: join(bin, 'psql.mock'),
    pgPassfile: join(root, 'pgpass.synthetic'), sslRootCert: join(root, 'ca.synthetic'),
  }
  for (const path of Object.values(paths)) await writeFile(path, 'synthetic test fixture')
  const calls = []
  for (const mode of ['early-exit', 'invalid', 'timeout']) {
    const config = {
      projectRef: 'abcdefghijklmnopqrst', host: 'db.abcdefghijklmnopqrst.supabase.co', port: 5432,
      database: 'postgres', username: 'backup_reader', timeoutMs: mode === 'timeout' ? 150 : 1000, ...paths,
    }
    const spawnProcess = (executable, args, options) => {
      calls.push({ executable, args, mode })
      return spawn(process.execPath, [mockProgram, executable, ...args], {
        ...options, cwd: root, env: { ...options.env, SYNTHETIC_COORDINATOR_MODE: mode },
      })
    }
    await assert.rejects(createPostgresBackupStreams(config, { spawnProcess }), error => {
      assert.doesNotMatch(error.message, /SYNTHETIC-SENSITIVE-TOKEN|00000001-00000002-1|NOT_A_SNAPSHOT/)
      return true
    }, `${mode} must fail closed`)
  }
  assert.equal(calls.filter(call => call.args[0] === '--version').length, 6)
})

test('an unresponsive PostgreSQL consumer is bounded, reaped, and reports cleanup failure without masking it', { timeout: 20000 }, async t => {
  const root = await mkdtemp(join(process.cwd(), '.test-pg-child-hard-timeout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'bin')
  await mkdir(bin)
  const mockProgram = join(root, 'mock-unresponsive-postgres.mjs')
  await writeFile(mockProgram, `
import { basename } from 'node:path'
const executable = basename(process.argv[2])
const args = process.argv.slice(3)
const tool = executable.startsWith('pg_dump') ? 'pg_dump' : 'psql'
if (args[0] === '--version') { process.stdout.write(tool + ' (PostgreSQL) 17.11\\n'); process.exit(0) }
if (tool === 'psql' && !args.includes('--command')) {
  let input = ''
  let emitted = false
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    input += chunk
    const marker = input.match(/\\\\echo (SP_SNAPSHOT_READY_[A-Fa-f0-9]+__)/)?.[1]
    if (marker && !emitted) {
      emitted = true
      process.stdout.write('00000001-00000002-1\\n' + marker + '\\n')
    }
    if (input.includes('\\\\q')) process.exit(0)
  })
  process.stdin.on('end', () => process.exit(0))
} else if (tool === 'pg_dump') {
  process.stdout.write('SYNTHETIC_PARTIAL_DUMP')
  setInterval(() => {}, 1000)
} else process.stdout.write('[]')
`)
  const paths = {
    pgDumpPath: join(bin, 'pg_dump.hung.mock'), psqlPath: join(bin, 'psql.hung.mock'),
    pgPassfile: join(root, 'pgpass.synthetic'), sslRootCert: join(root, 'ca.synthetic'),
  }
  for (const path of Object.values(paths)) await writeFile(path, 'synthetic test fixture')
  const children = []
  let ignoredSigterm = 0
  let forcedSigkill = 0
  let ignoreSigkill = false
  const spawnProcess = (executable, args, options) => {
    const child = spawn(process.execPath, [mockProgram, executable, ...args], { ...options, cwd: root })
    const nativeKill = child.kill.bind(child)
    let closed = false
    child.once('close', () => { closed = true })
    const isCoordinator = executable === paths.psqlPath && !args.includes('--command')
    children.push({ child, get closed() { return closed }, nativeKill, executable, args, isCoordinator })
    if (args[0] !== '--version' && (executable === paths.pgDumpPath || isCoordinator)) {
      child.kill = signal => {
        if (!signal || signal === 'SIGTERM') {
          if (executable === paths.pgDumpPath) ignoredSigterm += 1
          return true
        }
        if (signal === 'SIGKILL' && executable === paths.pgDumpPath) {
          forcedSigkill += 1
          if (ignoreSigkill) return true
        }
        return nativeKill(signal)
      }
    }
    return child
  }
  const config = {
    projectRef: 'abcdefghijklmnopqrst', host: 'db.abcdefghijklmnopqrst.supabase.co', port: 5432,
    database: 'postgres', username: 'backup_reader', timeoutMs: 500, ...paths,
  }
  const identity = await generateIdentity()
  const recipients = [await identityToRecipient(identity)]
  const streams = await createPostgresBackupStreams(config, { spawnProcess })
  const timedOutStream = streams.components[0].stream
  const task = createEncryptedBackupSet({
    destination: root, setName: 'timed-out-export', recipients,
    source: streams.source, components: streams.components,
  }).then(() => ({ kind: 'resolved' }), error => ({ kind: 'rejected', error }))
  let watchdog
  try {
    const outcome = await Promise.race([
      task,
      new Promise(resolve => { watchdog = setTimeout(() => resolve({ kind: 'hard-timeout' }), 7000) }),
    ])
    assert.equal(outcome.kind, 'rejected', 'hung exporter must settle before the hard test watchdog')
    assert.match(outcome.error.message, /PostgreSQL backup process timed out/i)
    assert.ok(ignoredSigterm > 0, 'synthetic child must ignore the initial graceful termination request')
    assert.ok(forcedSigkill > 0, 'cleanup must escalate to forced termination after the bounded grace period')
    assert.ok(children.some(item => item.executable === paths.pgDumpPath && item.closed), 'timed-out PostgreSQL child must emit close')
    assert.ok(children.some(item => item.isCoordinator && item.closed), 'snapshot coordinator must be closed and awaited after the consumer failure')
    assert.equal(timedOutStream.destroyed, true, 'failed consumer stream must be destroyed')
  } finally {
    clearTimeout(watchdog)
    for (const item of children) {
      if (item.executable === paths.pgDumpPath && item.child.exitCode === null && item.child.signalCode === null) item.nativeKill('SIGKILL')
    }
    await streams.close()
    await Promise.all(children.map(async item => {
      if (!item.closed) await new Promise(resolve => item.child.once('close', resolve))
    }))
  }
  assert.ok(children.every(item => item.closed), 'all owned PostgreSQL child processes must be reaped')
  assert.equal(await stat(join(root, 'timed-out-export')).then(() => true, () => false), false, 'failed export must not publish an encrypted set')

  ignoreSigkill = true
  const unkillableStreams = await createPostgresBackupStreams(config, { spawnProcess })
  const unkillableStream = unkillableStreams.components[0].stream
  const unkillableTask = createEncryptedBackupSet({
    destination: root, setName: 'cleanup-failed-export', recipients,
    source: unkillableStreams.source, components: unkillableStreams.components,
  }).then(() => ({ kind: 'resolved' }), error => ({ kind: 'rejected', error }))
  let cleanupWatchdog
  try {
    const outcome = await Promise.race([
      unkillableTask,
      new Promise(resolve => { cleanupWatchdog = setTimeout(() => resolve({ kind: 'hard-timeout' }), 12000) }),
    ])
    assert.equal(outcome.kind, 'rejected', 'cleanup failure must settle before the hard test watchdog')
    assert.match(outcome.error.message, /cleanup could not be confirmed/i)
    assert.equal(unkillableStream.destroyed, true, 'stream must close even when process termination cannot be confirmed')
    assert.ok(children.some(item => item.executable === paths.pgDumpPath && !item.closed), 'fixture must remain alive until test-owned emergency cleanup')
  } finally {
    clearTimeout(cleanupWatchdog)
    for (const item of children) {
      if (item.executable === paths.pgDumpPath && item.child.exitCode === null && item.child.signalCode === null) item.nativeKill('SIGKILL')
    }
    await unkillableStreams.close()
    await Promise.all(children.map(async item => {
      if (!item.closed) await new Promise(resolve => item.child.once('close', resolve))
    }))
  }
  assert.ok(children.every(item => item.closed), 'test-owned emergency cleanup must reap all fixture processes')
  assert.equal(await stat(join(root, 'cleanup-failed-export')).then(() => true, () => false), false, 'cleanup failure must not publish an encrypted set')
  assert.deepEqual((await readdir(root)).sort(), ['bin', 'ca.synthetic', 'mock-unresponsive-postgres.mjs', 'pgpass.synthetic'])
})
