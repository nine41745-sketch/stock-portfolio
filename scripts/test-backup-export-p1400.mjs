import assert from 'node:assert/strict'
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { test } from 'node:test'
import { generateIdentity, identityToRecipient } from 'age-encryption'
import { createEncryptedBackupSet, restoreEncryptedBackupSet, verifyEncryptedBackupSet } from './backup/encrypted-set.mjs'
import { buildPostgresDumpArguments, buildPostgresRolesArguments, buildPublicSchemaAclScript } from './backup/postgres-streams.mjs'

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
    { name: 'roles-global', stream: Readable.from([Buffer.from('SYNTHETIC-ROLE;\n')]) },
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
  assert.deepEqual(names, ['data-key.age', 'database-public.dump.aes256gcm', 'manifest.json.age', 'public-schema-acl.sql.aes256gcm', 'roles-global.sql.aes256gcm'])
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
  assert.equal(outputs.get('database-public').result().length, 256 * 1024 + Buffer.byteLength('SYNTHETIC-DATABASE-HEADER\n'))
  assert.equal(outputs.get('database-public').result().subarray(0, 26).toString(), 'SYNTHETIC-DATABASE-HEADER\n')
  assert.equal(outputs.get('roles-global').result().toString(), 'SYNTHETIC-ROLE;\n')
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
      { name: 'roles-global', stream: broken },
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
  const artifact = join(setPath, 'roles-global.sql.aes256gcm')
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
        if (name === 'roles-global') return new Writable({ write(_chunk, _encoding, callback) { callback(new Error('synthetic restore sink failure')) } })
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
  const roles = buildPostgresRolesArguments(connection)
  assert.ok(dump.includes('--schema=public'))
  assert.ok(dump.includes('--format=custom'))
  assert.ok(dump.includes('--no-password'))
  assert.ok(roles.includes('--roles-only'))
  assert.ok(roles.includes('--no-role-passwords'))
  for (const args of [dump, roles]) assert.equal(args.some(arg => /^--password$|password=|secret|token/i.test(arg)), false)
  assert.throws(() => buildPostgresDumpArguments({ ...connection, host: 'attacker.example' }))
})

test('public schema ACL serializer preserves granted roles safely and rejects untrusted ACL fields', () => {
  const script=buildPublicSchemaAclScript([
    {grantee:null,grantor:'pg_database_owner',privilege:'USAGE',grantable:false},
    {grantee:'odd"role',grantor:'pg_database_owner',privilege:'CREATE',grantable:true},
  ])
  assert.match(script,/GRANT USAGE ON SCHEMA public TO PUBLIC;/)
  assert.match(script,/GRANT CREATE ON SCHEMA public TO "odd""role" WITH GRANT OPTION;/)
  assert.match(script,/SET LOCAL ROLE "pg_database_owner";/)
  assert.throws(()=>buildPublicSchemaAclScript([{grantee:'x',grantor:'owner',privilege:'DROP',grantable:false}]))
  assert.match(buildPublicSchemaAclScript([{grantee:'x; SELECT 1',grantor:'owner',privilege:'USAGE',grantable:false}]),/TO "x; SELECT 1";/)
  assert.throws(()=>buildPublicSchemaAclScript([{grantee:'bad\nrole',grantor:'owner',privilege:'USAGE',grantable:false}]))
})
