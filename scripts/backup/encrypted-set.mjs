import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Decrypter, Encrypter, identityToRecipient } from 'age-encryption'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const FORMAT = 'stock-portfolio-backup-set'
const VERSION = 3
const MANIFEST_FILE = 'manifest.json.age'
const KEY_FILE = 'data-key.age'
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_COMPONENT_BYTES = 1024 ** 4
const MAX_STREAM_DURATION_MS = 8 * 60 * 60 * 1000
const COMPONENTS = Object.freeze({
  'database-public': 'database-public.dump.aes256gcm',
  'public-role-dependencies': 'public-role-dependencies.sql.aes256gcm',
  'public-schema-acl': 'public-schema-acl.sql.aes256gcm',
})
const COVERAGE = () => ({
  applicationPublicSchema: 'INCLUDED_DUMP_NOT_RESTORE_VERIFIED',
  publicSchemaAcl: 'INCLUDED_EXACT_ACL_SCRIPT',
  portfolioData: 'INCLUDED_IF_STORED_IN_PUBLIC_SCHEMA',
  rlsAndRpcDefinitions: 'INCLUDED_IF_STORED_IN_PUBLIC_SCHEMA',
  rolesAndGrants: 'PUBLIC_DEPENDENCIES_ONLY_EXISTING_TARGET_ROLES_REQUIRED',
  roleMembershipsAndAttributes: 'NOT_EXPORTED_REQUIRE_INDEPENDENT_PLATFORM_EQUIVALENCE_REVIEW',
  extensions: 'PUBLIC_DUMP_SCOPE_ONLY_MANAGED_EXTENSION_RUNTIME_UNVERIFIED',
  supabaseAuth: 'NOT_EXPORTED',
  storageMetadata: 'NOT_EXPORTED',
  storageObjectBytes: 'NOT_EXPORTED',
  migrationHistory: 'INCLUDED_ONLY_IF_STORED_IN_PUBLIC_SCHEMA',
  platformConfiguration: 'NOT_EXPORTED',
  secrets: 'NOT_EXPORTED',
})

const fail = message => { throw new Error(message) }
const exactKeys = (value, keys, label) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has unexpected fields`)
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
async function boundedPipeline(streams, timeoutMs = MAX_STREAM_DURATION_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try { await pipeline(...streams, { signal: controller.signal }) }
  finally { clearTimeout(timer) }
}
const samePath = (a, b) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)

function validateSetName(name) {
  assert.equal(typeof name, 'string')
  assert.match(name, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  assert.ok(name !== '.' && name !== '..' && !/[. ]$/.test(name), 'Unsafe backup set name')
  assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name), 'Reserved backup set name')
}

function validateSource(source) {
  exactKeys(source, ['projectRef', 'schema', 'capturedAt', 'pgDumpVersion', 'psqlVersion', 'serverVersion', 'rolesDumpVersion', 'snapshot'], 'Source')
  assert.match(source.projectRef, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 'Invalid source project reference')
  assert.equal(source.schema, 'public', 'Only the approved application schema can be exported')
  assert.equal(typeof source.capturedAt, 'string')
  assert.ok(Number.isFinite(Date.parse(source.capturedAt)), 'Invalid capture timestamp')
  assert.ok(source.capturedAt.length <= 40 && !/[\r\n]/.test(source.capturedAt), 'Invalid capture timestamp')
  for (const field of ['pgDumpVersion', 'psqlVersion', 'serverVersion', 'rolesDumpVersion', 'snapshot']) {
    assert.equal(typeof source[field], 'string')
    assert.ok(source[field].length > 0 && source[field].length <= 160 && !/[\r\n]/.test(source[field]), `Invalid ${field}`)
  }
}

function validateComponents(components) {
  assert.ok(Array.isArray(components) && components.length === 3, 'Expected the complete three-component backup set')
  const seen = new Set()
  for (const component of components) {
    exactKeys(component, ['name', 'stream'], 'Component')
    assert.ok(Object.hasOwn(COMPONENTS, component.name), 'Unknown backup component')
    assert.ok(!seen.has(component.name), 'Duplicate backup component')
    assert.ok(component.stream instanceof Readable, 'Backup component must be a Node Readable stream')
    seen.add(component.name)
  }
  assert.ok(seen.has('database-public'), 'Public schema dump is required')
  assert.ok(seen.has('public-role-dependencies'), 'Public role dependency evidence is required')
  assert.ok(seen.has('public-schema-acl'), 'Public schema ACL is required')
  return ['database-public', 'public-role-dependencies', 'public-schema-acl'].filter(name => seen.has(name))
}

function validateRecipients(recipients) {
  assert.ok(Array.isArray(recipients) && recipients.length >= 1 && recipients.length <= 2, 'One or two age recipients are required')
  assert.ok(recipients.every(key => typeof key === 'string' && /^age1[0-9a-z]{20,100}$/.test(key)), 'Only standard age X25519 recipients are accepted')
  assert.equal(new Set(recipients).size, recipients.length, 'Duplicate age recipients are forbidden')
}

async function safeDirectory(path) {
  const absolute = resolve(path)
  const parts = absolute.split(sep).filter(Boolean)
  let cursor = absolute.startsWith(sep) ? sep : parts.shift() + sep
  for (const part of parts) {
    cursor = join(cursor, part)
    const info = await lstat(cursor)
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Backup paths cannot contain symlink or reparse directories')
  }
  assert.ok(samePath(await realpath(absolute), absolute), 'Backup destination resolves elsewhere')
  return absolute
}

async function assertRegularArtifact(path, maxBytes = MAX_COMPONENT_BYTES + 1024 * 1024) {
  const info = await lstat(path)
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'Backup artifacts must be single-link regular files')
  assert.ok(info.size > 0 && info.size <= maxBytes, 'Backup artifact size is invalid')
  assert.ok(samePath(await realpath(path), path), 'Backup artifact path was redirected')
  return info
}

function ageEncryptor(recipients) {
  const encrypter = new Encrypter()
  try { recipients.forEach(recipient => encrypter.addRecipient(recipient)) }
  catch { fail('Invalid age recipient configuration') }
  return encrypter
}

function ageDecrypter(identities) {
  assert.ok(Array.isArray(identities) && identities.length >= 1 && identities.length <= 2, 'One or two age identities are required')
  assert.ok(identities.every(key => typeof key === 'string' && key.startsWith('AGE-SECRET-KEY-1')), 'Age identities are required')
  assert.equal(new Set(identities).size, identities.length, 'Duplicate age identities are forbidden')
  const decrypter = new Decrypter()
  try { identities.forEach(identity => decrypter.addIdentity(identity)) }
  catch { fail('Invalid age identity configuration') }
  return decrypter
}

function meterStream(onChunk) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      try { onChunk(chunk); callback(null, chunk) }
      catch (error) { callback(error) }
    },
  })
}

async function writeAgeStream(input, recipients, path, timeoutMs = MAX_STREAM_DURATION_MS) {
  const plaintext = { bytes: 0, hash: createHash('sha256') }
  const encrypted = { bytes: 0, hash: createHash('sha256') }
  const plainMeter = meterStream(chunk => {
    plaintext.bytes += chunk.length
    assert.ok(plaintext.bytes <= MAX_COMPONENT_BYTES, 'Backup component exceeds the configured bound')
    plaintext.hash.update(chunk)
  })
  const encryptedMeter = meterStream(chunk => {
    encrypted.bytes += chunk.length
    encrypted.hash.update(chunk)
  })
  let encryptedWeb
  try {
    encryptedWeb = await ageEncryptor(recipients).encrypt(Readable.toWeb(input.pipe(plainMeter)))
    await boundedPipeline([Readable.fromWeb(encryptedWeb), encryptedMeter, createWriteStream(path, { flags: 'wx', mode: 0o600 })], timeoutMs)
  } catch {
    input.destroy()
    plainMeter.destroy()
    encryptedMeter.destroy()
    fail('Encrypted stream generation failed')
  }
  return {
    plaintextBytes: plaintext.bytes,
    plaintextSha256: plaintext.hash.digest('hex'),
    ciphertextBytes: encrypted.bytes,
    ciphertextSha256: encrypted.hash.digest('hex'),
  }
}

function componentAad(source, name) {
  return Buffer.from(JSON.stringify({ format: FORMAT, version: VERSION, source, component: name }))
}

async function writeGcmStream(input, key, source, name, path, timeoutMs) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })
  cipher.setAAD(componentAad(source, name))
  const plaintext = { bytes: 0, hash: createHash('sha256') }
  const ciphertext = { bytes: 0, hash: createHash('sha256') }
  const plainMeter = meterStream(chunk => {
    plaintext.bytes += chunk.length
    assert.ok(plaintext.bytes <= MAX_COMPONENT_BYTES, 'Backup component exceeds the configured bound')
    plaintext.hash.update(chunk)
  })
  const cipherMeter = meterStream(chunk => { ciphertext.bytes += chunk.length; ciphertext.hash.update(chunk) })
  try {
    await boundedPipeline([input, plainMeter, cipher, cipherMeter, createWriteStream(path, { flags: 'wx', mode: 0o600 })], timeoutMs)
    assert.ok(plaintext.bytes > 0, 'Empty backup components are forbidden')
    return {
      plaintextBytes: plaintext.bytes,
      plaintextSha256: plaintext.hash.digest('hex'),
      ciphertextBytes: ciphertext.bytes,
      ciphertextSha256: ciphertext.hash.digest('hex'),
      nonce: nonce.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    }
  } catch {
    input.destroy()
    if (input.postgresProcessFailure === 'CLEANUP_FAILED') fail('PostgreSQL backup child cleanup could not be confirmed; export aborted')
    if (input.postgresProcessFailure === 'TIMEOUT') fail('PostgreSQL backup process timed out; export aborted')
    if (input.postgresProcessFailure === 'PROCESS_FAILED') fail('PostgreSQL backup process failed; export aborted')
    fail('AES-256-GCM component encryption failed')
  } finally { nonce.fill(0) }
}

async function decryptToWritable(path, identities, output, limit = MAX_COMPONENT_BYTES) {
  const ciphertext = { bytes: 0, hash: createHash('sha256') }
  const plaintext = { bytes: 0, hash: createHash('sha256') }
  const cipherMeter = meterStream(chunk => {
    ciphertext.bytes += chunk.length
    assert.ok(ciphertext.bytes <= limit + 1024 * 1024, 'Encrypted artifact exceeds the configured bound')
    ciphertext.hash.update(chunk)
  })
  const plainMeter = meterStream(chunk => {
    plaintext.bytes += chunk.length
    assert.ok(plaintext.bytes <= limit, 'Decrypted component exceeds the configured bound')
    plaintext.hash.update(chunk)
  })
  const input = createReadStream(path)
  input.pipe(cipherMeter)
  try {
    const plainWeb = await ageDecrypter(identities).decrypt(Readable.toWeb(cipherMeter))
    await boundedPipeline([Readable.fromWeb(plainWeb), plainMeter, output])
  } catch {
    input.destroy()
    cipherMeter.destroy()
    plainMeter.destroy()
    fail('Encrypted artifact authentication or stream verification failed')
  }
  return {
    ciphertextBytes: ciphertext.bytes,
    ciphertextSha256: ciphertext.hash.digest('hex'),
    plaintextBytes: plaintext.bytes,
    plaintextSha256: plaintext.hash.digest('hex'),
  }
}

async function readAgeKey(path, identities) {
  const chunks = []
  let bytes = 0
  const output = new Writable({
    write(chunk, _encoding, callback) {
      bytes += chunk.length
      if (bytes > 32) return callback(new Error('key length'))
      chunks.push(Buffer.from(chunk)); callback()
    },
  })
  await decryptToWritable(path, identities, output, 32)
  const key = Buffer.concat(chunks)
  assert.equal(key.length, 32, 'Encrypted data key has an invalid length')
  return key
}

async function decryptGcmToWritable(path, key, source, component, output) {
  assert.equal(typeof component.nonce, 'string')
  assert.equal(typeof component.authTag, 'string')
  const nonce = Buffer.from(component.nonce, 'base64')
  const tag = Buffer.from(component.authTag, 'base64')
  assert.equal(nonce.length, 12, 'Invalid AES-GCM nonce')
  assert.equal(tag.length, 16, 'Invalid AES-GCM tag')
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })
  decipher.setAAD(componentAad(source, component.name))
  decipher.setAuthTag(tag)
  const ciphertext = { bytes: 0, hash: createHash('sha256') }
  const plaintext = { bytes: 0, hash: createHash('sha256') }
  const cipherMeter = meterStream(chunk => { ciphertext.bytes += chunk.length; ciphertext.hash.update(chunk) })
  const plainMeter = meterStream(chunk => {
    plaintext.bytes += chunk.length
    assert.ok(plaintext.bytes <= MAX_COMPONENT_BYTES, 'Decrypted component exceeds the configured bound')
    plaintext.hash.update(chunk)
  })
  try { await boundedPipeline([createReadStream(path), cipherMeter, decipher, plainMeter, output]) }
  catch { fail('AES-256-GCM component authentication or stream verification failed') }
  return {
    ciphertextBytes: ciphertext.bytes,
    ciphertextSha256: ciphertext.hash.digest('hex'),
    plaintextBytes: plaintext.bytes,
    plaintextSha256: plaintext.hash.digest('hex'),
  }
}

async function readEncryptedManifest(path, identities) {
  const info = await assertRegularArtifact(path, MAX_MANIFEST_BYTES + 64 * 1024)
  assert.ok(info.size <= MAX_MANIFEST_BYTES + 64 * 1024, 'Encrypted manifest exceeds the configured bound')
  const chunks = []
  let bytes = 0
  const output = new Writable({
    write(chunk, _encoding, callback) {
      bytes += chunk.length
      if (bytes > MAX_MANIFEST_BYTES) return callback(new Error('manifest limit'))
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  await decryptToWritable(path, identities, output, MAX_MANIFEST_BYTES)
  return Buffer.concat(chunks).toString('utf8')
}

async function validateManifest(manifest, identities, expectedProjectRef) {
  exactKeys(manifest, ['format', 'version', 'createdAt', 'source', 'encryption', 'dataKeyFile', 'dataKeySha256', 'recipientFingerprints', 'components', 'coverage'], 'Manifest')
  assert.equal(manifest.format, FORMAT)
  assert.equal(manifest.version, VERSION)
  assert.equal(manifest.encryption, 'AES-256-GCM components; age-v1-X25519 wrapped data key and manifest')
  assert.equal(manifest.dataKeyFile, KEY_FILE)
  assert.match(manifest.dataKeySha256, /^[0-9a-f]{64}$/)
  validateSource(manifest.source)
  assert.equal(manifest.source.projectRef, expectedProjectRef, 'Backup source identity does not match the expected project')
  assert.ok(Number.isFinite(Date.parse(manifest.createdAt)) && manifest.createdAt.length <= 40)
  assert.ok(Array.isArray(manifest.recipientFingerprints) && manifest.recipientFingerprints.length >= 1 && manifest.recipientFingerprints.length <= 2)
  for (const fingerprint of manifest.recipientFingerprints) assert.match(fingerprint, /^[0-9a-f]{64}$/)
  const derived = await Promise.all(identities.map(identity => identityToRecipient(identity)))
  assert.ok(derived.some(recipient => manifest.recipientFingerprints.includes(sha256(Buffer.from(recipient)))), 'Identity is not a declared backup recipient')
  assert.ok(Array.isArray(manifest.components) && manifest.components.length === 3)
  const names = manifest.components.map(item => item.name)
  assert.equal(names[0], 'database-public', 'Required component is missing or unordered')
  assert.ok(names.every((name, index) => Object.hasOwn(COMPONENTS, name) && (index === 0 || name > names[index - 1])), 'Unknown, duplicate or unordered component')
  for (const item of manifest.components) {
    exactKeys(item, ['name', 'file', 'plaintextBytes', 'plaintextSha256', 'ciphertextBytes', 'ciphertextSha256', 'nonce', 'authTag'], 'Component metadata')
    assert.equal(item.file, COMPONENTS[item.name])
    for (const field of ['plaintextBytes', 'ciphertextBytes']) assert.ok(Number.isSafeInteger(item[field]) && item[field] > 0 && item[field] <= MAX_COMPONENT_BYTES + 1024 * 1024)
    for (const field of ['plaintextSha256', 'ciphertextSha256']) assert.match(item[field], /^[0-9a-f]{64}$/)
    assert.equal(Buffer.from(item.nonce, 'base64').length, 12, 'Invalid component nonce')
    assert.equal(Buffer.from(item.authTag, 'base64').length, 16, 'Invalid component authentication tag')
  }
  assert.deepEqual(manifest.coverage, COVERAGE(), 'Coverage claims do not match the archived component set')
}

async function safeCleanupStage(stage, createdFiles) {
  for (const path of [...createdFiles].reverse()) {
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('staging artifact ownership changed')
      await unlink(path)
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Owned staging cleanup failed')
    }
  }
  await rmdir(stage)
}

export async function createEncryptedBackupSet({ destination, setName, recipients, source, components, createdAt = new Date().toISOString(), timeoutMs = 4 * 60 * 60 * 1000, beforePublish = async () => {} }) {
  validateSetName(setName)
  validateRecipients(recipients)
  validateSource(source)
  const names = validateComponents(components)
  assert.ok(typeof beforePublish === 'function', 'Backup publication guard must be callable')
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_STREAM_DURATION_MS, 'Backup stream deadline is outside the supported bound')
  source = Object.freeze({ ...source })
  assert.ok(Number.isFinite(Date.parse(createdAt)) && createdAt.length <= 40, 'Invalid manifest timestamp')
  const base = await safeDirectory(destination)
  const target = join(base, setName)
  try { await lstat(target); fail('Backup destination already exists') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const stage = join(base, `.${setName}.${randomUUID()}.partial`)
  await mkdir(stage, { mode: 0o700 })
  const createdFiles = []
  const dataKey = randomBytes(32)
  try {
    const keyPath = join(stage, KEY_FILE)
    createdFiles.push(keyPath)
    await writeAgeStream(Readable.from([dataKey]), recipients, keyPath, timeoutMs)
    const componentRecords = []
    for (const name of names) {
      const file = COMPONENTS[name]
      const path = join(stage, file)
      createdFiles.push(path)
      const encrypted = await writeGcmStream(components.find(item => item.name === name).stream, dataKey, source, name, path, timeoutMs)
      componentRecords.push({ name, file, ...encrypted })
    }
    const manifest = {
      format: FORMAT,
      version: VERSION,
      createdAt,
      source,
      encryption: 'AES-256-GCM components; age-v1-X25519 wrapped data key and manifest',
      dataKeyFile: KEY_FILE,
      dataKeySha256: sha256(dataKey),
      recipientFingerprints: recipients.map(recipient => sha256(Buffer.from(recipient))),
      components: componentRecords,
      coverage: COVERAGE(),
    }
    const manifestPath = join(stage, MANIFEST_FILE)
    createdFiles.push(manifestPath)
    const manifestBytes = Buffer.from(JSON.stringify(manifest))
    assert.ok(manifestBytes.length <= MAX_MANIFEST_BYTES, 'Manifest exceeds the configured bound')
    try { await writeAgeStream(Readable.from([manifestBytes]), recipients, manifestPath, timeoutMs) }
    finally { manifestBytes.fill(0) }
    await beforePublish()
    await rename(stage, target)
    return { setPath: target, componentCount: componentRecords.length, coverage: manifest.coverage }
  } catch (error) {
    try { await safeCleanupStage(stage, createdFiles) }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Encrypted backup creation failed and owned staging cleanup also failed')
    }
    throw error
  } finally { dataKey.fill(0) }
}

export async function verifyEncryptedBackupSet({ setPath, identities, expectedProjectRef }) {
  assert.ok(typeof expectedProjectRef === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(expectedProjectRef), 'Expected source identity is required')
  ageDecrypter(identities)
  const directory = await safeDirectory(setPath)
  const directoryInfo = await lstat(directory)
  assert.ok(directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink(), 'Backup set must be a real directory')
  const manifestPath = join(directory, MANIFEST_FILE)
  const json = await readEncryptedManifest(manifestPath, identities)
  assert.ok(Buffer.byteLength(json, 'utf8') <= MAX_MANIFEST_BYTES, 'Manifest exceeds the configured bound')
  let manifest
  try { manifest = JSON.parse(json) } catch { fail('Encrypted manifest is malformed') }
  await validateManifest(manifest, identities, expectedProjectRef)
  const expectedFiles = [MANIFEST_FILE, KEY_FILE, ...manifest.components.map(item => item.file)].sort()
  assert.deepEqual((await readdir(directory)).sort(), expectedFiles, 'Backup set is incomplete or contains unexpected files')
  const keyPath = join(directory, KEY_FILE)
  await assertRegularArtifact(keyPath, 64 * 1024)
  const dataKey = await readAgeKey(keyPath, identities)
  try {
    assert.equal(sha256(dataKey), manifest.dataKeySha256, 'Wrapped data key does not match the encrypted manifest')
    for (const component of manifest.components) {
      const path = join(directory, component.file)
      const info = await assertRegularArtifact(path)
      assert.equal(info.size, component.ciphertextBytes, 'Encrypted artifact size differs from the manifest')
      const sink = new Writable({ write(_chunk, _encoding, callback) { callback() } })
      const actual = await decryptGcmToWritable(path, dataKey, manifest.source, component, sink)
      assert.equal(actual.ciphertextBytes, component.ciphertextBytes)
      assert.equal(actual.ciphertextSha256, component.ciphertextSha256, 'Encrypted artifact checksum mismatch')
      assert.equal(actual.plaintextBytes, component.plaintextBytes)
      assert.equal(actual.plaintextSha256, component.plaintextSha256, 'Decrypted component checksum mismatch')
    }
  } finally { dataKey.fill(0) }
  return {
    result: 'VERIFIED',
    source: manifest.source,
    dataKeySha256: manifest.dataKeySha256,
    components: manifest.components.map(({ name, plaintextBytes, plaintextSha256, ciphertextBytes, ciphertextSha256, file, nonce, authTag }) => ({ name, file, bytes: plaintextBytes, sha256: plaintextSha256, ciphertextBytes, ciphertextSha256, nonce, authTag })),
    coverage: manifest.coverage,
    recipientFingerprints: [...manifest.recipientFingerprints],
  }
}

export async function restoreEncryptedBackupSet({ setPath, identities, expectedProjectRef, beginRestore }) {
  const verified = await verifyEncryptedBackupSet({ setPath, identities, expectedProjectRef })
  assert.equal(typeof beginRestore, 'function', 'A disposable restore transaction is required')
  const transaction = await beginRestore(verified)
  assert.ok(transaction && typeof transaction === 'object', 'Invalid restore transaction')
  assert.equal(typeof transaction.createSink, 'function')
  assert.equal(typeof transaction.commit, 'function')
  assert.equal(typeof transaction.rollback, 'function')
  const dataKey = await readAgeKey(join(resolve(setPath), KEY_FILE), identities)
  try {
    assert.equal(sha256(dataKey), verified.dataKeySha256, 'Wrapped data key changed after verification')
    // A dependency guard failure must occur before any database sink opens.
    const order = ['public-role-dependencies', 'database-public', 'public-schema-acl']
    for (const name of order) {
      const component = verified.components.find(item => item.name === name)
      assert.ok(component, 'Required restore component missing')
      const sink = transaction.createSink(name)
      assert.ok(sink instanceof Writable, 'Restore sink must be a Writable stream')
      const actual = await decryptGcmToWritable(join(resolve(setPath), component.file), dataKey, verified.source, component, sink)
      assert.equal(actual.ciphertextBytes, component.ciphertextBytes)
      assert.equal(actual.ciphertextSha256, component.ciphertextSha256, 'Encrypted component changed after verification')
      assert.equal(actual.plaintextBytes, component.bytes, 'Restored component size changed')
      assert.equal(actual.plaintextSha256, component.sha256, 'Restored component hash changed')
    }
    await transaction.commit()
  } catch (error) {
    try { await transaction.rollback() } catch { fail('Restore failed and disposable target rollback also failed') }
    throw error
  } finally { dataKey.fill(0) }
  return { result: 'RESTORED_FROM_VERIFIED_SET', components: verified.components.length }
}
