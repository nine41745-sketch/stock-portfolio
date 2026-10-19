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
  const dump = buildPostgresDumpArguments(connection)
  assert.throws(() => buildPostgresRolesArguments(connection), /Global role export is disabled/)
  assert.ok(dump.includes('--schema=public'))
  assert.ok(dump.includes('--format=custom'))
  assert.ok(dump.includes('--no-password'))
  for (const args of [dump]) assert.equal(args.some(arg => /^--password$|password=|secret|token/i.test(arg)), false)
  assert.throws(() => buildPostgresDumpArguments({ ...connection, host: 'attacker.example' }))
})

test('PostgreSQL dump programs write to stdout and never receive a persistent output-file option', () => {
  const connection = { projectRef: 'abcdefghijklmnopqrst', host: 'db.abcdefghijklmnopqrst.supabase.co', port: 5432, database: 'postgres', username: 'backup_reader' }
  for (const args of [buildPostgresDumpArguments(connection)]) {
    assert.equal(args.some(arg => /^--file(?:=|$)|^-f(?:$|.)/.test(arg)), false, 'dump output must remain on stdout')
  }
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
      database: 'postgres', username: 'backup_reader', timeoutMs: suffix.includes('timeout') ? 400 : 3000,
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
  await createEncryptedBackupSet({ destination: root, setName: 'encrypted-success', recipients, source: { ...source, ...successful.source }, components: successful.components })
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
    const { source: mockSource, components } = await createPostgresBackupStreams(config, { spawnProcess: invoke(config, calls) })
    await assert.rejects(createEncryptedBackupSet({
      destination: root, setName: `encrypted-${mode}`, recipients,
      source: { ...source, ...mockSource }, components,
    }), undefined, `${mode} child process must fail closed`)
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
