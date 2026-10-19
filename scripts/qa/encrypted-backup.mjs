// Synthetic QA only: this is not a Production export or key-custody system.
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { constants, openSync, closeSync, fstatSync, lstatSync, realpathSync, readSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { sha256 } from './recovery-safety.mjs'

const MAGIC = Buffer.from('SPQAENC1'), MAX_HEADER = 64 * 1024, MAX_DATA = 64 * 1024 * 1024
const NAMES = ['database.dump', 'roles.sql'], ARTIFACT = 'backup.spenc'
const FORMAT = 'stock-portfolio-synthetic-backup', ALGORITHM = 'AES-256-GCM'
const exactKeys = (value, keys) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected object')
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Unexpected metadata fields')
}
function validateContext(ctx) {
  exactKeys(ctx, ['run', 'sourceCommit', 'sourceFiles'])
  assert.match(ctx.run, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.match(ctx.sourceCommit, /^[0-9a-f]{40}$/)
  assert.ok(Array.isArray(ctx.sourceFiles) && ctx.sourceFiles.length > 0 && ctx.sourceFiles.length <= 100, 'Missing/bounded source inventory')
  const files = new Set()
  for (const item of ctx.sourceFiles) {
    exactKeys(item, ['file', 'sha256'])
    assert.match(item.file, /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/)
    assert.ok(!item.file.split('/').some(p => p === '.' || p === '..') && !files.has(item.file), 'Invalid/duplicate source file')
    assert.match(item.sha256, /^[0-9a-f]{64}$/)
    files.add(item.file)
  }
}
function validateKey(key) { assert.ok(Buffer.isBuffer(key) && key.length === 32, 'A fresh in-memory 256-bit key is required') }
function descriptors(data) {
  exactKeys(data, NAMES)
  let total = 0
  return NAMES.map(name => {
    const b = data[name]
    assert.ok(Buffer.isBuffer(b) && b.length > 0, 'Missing backup component')
    total += b.length
    assert.ok(total <= MAX_DATA, 'Synthetic backup exceeds memory limit')
    return { name, bytes: b.length, sha256: sha256(b) }
  })
}
export function sealSyntheticBackup(data, ctx, key) {
  validateKey(key); validateContext(ctx)
  const header = Buffer.from(JSON.stringify({ format: FORMAT, version: 1, algorithm: ALGORITHM, syntheticOnly: true, context: ctx, components: descriptors(data) }))
  assert.ok(header.length <= MAX_HEADER)
  const prefix = Buffer.alloc(12); MAGIC.copy(prefix); prefix.writeUInt32BE(header.length, 8)
  const aad = Buffer.concat([prefix, header]), nonce = randomBytes(12)
  // A fresh key is used per runner invocation; a fresh random 96-bit nonce per seal.
  const plain = Buffer.concat(NAMES.map(name => data[name]))
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })
    cipher.setAAD(aad)
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
    return Buffer.concat([aad, nonce, cipher.getAuthTag(), encrypted])
  } finally { plain.fill(0) }
}
export function openSyntheticBackup(blob, key, expectedContext) {
  validateKey(key); validateContext(expectedContext)
  assert.ok(Buffer.isBuffer(blob) && blob.length >= 40 && blob.length <= MAX_DATA + MAX_HEADER + 40, 'Invalid envelope size')
  assert.ok(blob.subarray(0,8).equals(MAGIC), 'Unknown backup format')
  const length = blob.readUInt32BE(8), offset = 12 + length
  assert.ok(length > 0 && length <= MAX_HEADER && offset + 28 < blob.length, 'Incomplete envelope')
  const h = JSON.parse(blob.subarray(12,offset).toString('utf8'))
  exactKeys(h, ['format','version','algorithm','syntheticOnly','context','components'])
  assert.equal(h.format, FORMAT); assert.equal(h.version, 1); assert.equal(h.algorithm, ALGORITHM); assert.equal(h.syntheticOnly, true)
  validateContext(h.context); assert.deepEqual(h.context, expectedContext, 'Source/run substitution')
  assert.ok(Array.isArray(h.components)); assert.deepEqual(h.components.map(a => a.name), NAMES, 'Incomplete/duplicate backup set')
  let total = 0
  for (const a of h.components) {
    exactKeys(a,['name','bytes','sha256'])
    assert.ok(Number.isSafeInteger(a.bytes) && a.bytes > 0)
    assert.match(a.sha256,/^[0-9a-f]{64}$/); total += a.bytes
  }
  assert.ok(total <= MAX_DATA && total === blob.length - offset - 28, 'Component length mismatch')
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(offset,offset+12), {authTagLength:16})
  decipher.setAAD(blob.subarray(0,offset)); decipher.setAuthTag(blob.subarray(offset+12,offset+28))
  let untrusted, plain
  const result = {}
  try {
    untrusted = decipher.update(blob.subarray(offset+28))
    // Do not return/restore ANY update() output until final() authenticates the complete set.
    const tail = decipher.final()
    plain = Buffer.concat([untrusted,tail]); tail.fill(0)
    let cursor = 0
    for (const a of h.components) {
      const b = plain.subarray(cursor,cursor+a.bytes)
      assert.equal(sha256(b),a.sha256,'Archive hash mismatch')
      result[a.name] = Buffer.from(b); cursor += a.bytes
    }
    return result
  } catch {
    Object.values(result).forEach(b=>b.fill(0))
    throw new Error('Synthetic backup authentication/integrity verification failed')
  } finally { untrusted?.fill(0); plain?.fill(0) }
}
const pathKey = p => process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p)
function safeRoot(root) {
  const base = resolve(root)
  for (let p = base; ; p = dirname(p)) {
    const info = lstatSync(p)
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Symlink/reparse backup directory forbidden')
    if (dirname(p) === p) break
  }
  assert.equal(pathKey(realpathSync(base)),pathKey(base),'Backup directory redirected')
  return base
}
function descriptor(blob, context) {
  return {format:'stock-portfolio-encrypted-set',version:1,syntheticOnly:true,context,artifacts:[{name:ARTIFACT,bytes:blob.length,sha256:sha256(blob)}]}
}
export function writeEncryptedSet(root, data, context, key) {
  const base = safeRoot(root)
  // Seal the exact allowlisted components here so callers cannot persist an
  // arbitrary Buffer while receiving metadata that claims it is encrypted.
  const blob = sealSyntheticBackup(data, context, key)
  // Exclusive creation prevents overwrite; only this fixed artifact name is ever used.
  writeFileSync(join(base,ARTIFACT),blob,{flag:'wx',mode:0o600})
  return descriptor(blob,context)
}
export function verifyEncryptedSet(root, manifest, key, expectedContext) {
  validateContext(expectedContext)
  const base = safeRoot(root), path = join(base,ARTIFACT), info = lstatSync(path)
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'Artifact must be a single regular file')
  assert.equal(pathKey(realpathSync(path)),pathKey(path),'Artifact redirected')
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const current = fstatSync(fd)
    assert.ok(current.isFile() && current.nlink === 1 && current.ino === info.ino && current.dev === info.dev, 'Artifact changed during open')
    assert.ok(current.size > 0 && current.size <= MAX_DATA + MAX_HEADER + 40, 'Unbounded encrypted file')
    const blob = Buffer.alloc(current.size)
    let cursor = 0
    while (cursor < blob.length) {
      const count = readSync(fd,blob,cursor,blob.length-cursor,null)
      assert.ok(count > 0,'Artifact truncated during read'); cursor += count
    }
    assert.equal(readSync(fd,Buffer.alloc(1),0,1,null),0,'Artifact grew during bounded read')
    const after = fstatSync(fd)
    assert.equal(after.size,current.size); assert.equal(after.mtimeMs,current.mtimeMs)
    assert.deepEqual(manifest,descriptor(blob,expectedContext),'Modified/incomplete encrypted manifest')
    return openSyntheticBackup(blob,key,expectedContext)
  } finally { closeSync(fd) }
}
