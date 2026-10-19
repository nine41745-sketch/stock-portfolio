import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, linkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sealSyntheticBackup, openSyntheticBackup, writeEncryptedSet, verifyEncryptedSet } from './qa/encrypted-backup.mjs'
import { sha256 } from './qa/recovery-safety.mjs'

const context = () => ({ run: randomUUID(), sourceCommit: 'a'.repeat(40), sourceFiles: [{file:'scripts/qa/backup-recovery.mjs',sha256:'b'.repeat(64)}] })
const components = () => ({ 'database.dump': Buffer.from('PGDMP-synthetic-only-archive'), 'roles.sql': Buffer.from('CREATE ROLE synthetic NOLOGIN;') })
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'stock-encrypted-unit-'))
  const key = randomBytes(32), ctx = context(), data = components()
  try { return fn({ root, key, ctx, data }) } finally { key.fill(0); Object.values(data).forEach(b=>b.fill(0)); rmSync(root,{recursive:true}) }
}
function header(blob) { return JSON.parse(blob.subarray(12,12+blob.readUInt32BE(8)).toString()) }
function changeHeader(blob, mutate) {
  const h = header(blob); mutate(h)
  const json=Buffer.from(JSON.stringify(h)), prefix=Buffer.alloc(12)
  blob.copy(prefix,0,0,8);prefix.writeUInt32BE(json.length,8)
  return Buffer.concat([prefix,json,blob.subarray(12+blob.readUInt32BE(8))])
}
test('authenticated round trip returns both exact components and source binding',()=>fixture(({key,ctx,data})=>{
  const blob=sealSyntheticBackup(data,ctx,key)
  const restored=openSyntheticBackup(blob,key,ctx)
  assert.deepEqual(restored,data)
  assert.ok(!blob.includes(data['roles.sql']))
}))
test('each seal generates a fresh 96-bit nonce',()=>fixture(({key,ctx,data})=>{
  const a=sealSyntheticBackup(data,ctx,key), b=sealSyntheticBackup(data,ctx,key)
  const offset=12+a.readUInt32BE(8)
  assert.notDeepEqual(a.subarray(offset,offset+12),b.subarray(offset,offset+12))
  assert.notDeepEqual(a,b)
}))
for(const [name,mutate] of [
  ['ciphertext tamper', b=>{b[b.length-1]^=1}],
  ['tag tamper',b=>{b[12+b.readUInt32BE(8)+12]^=1}],
  ['nonce tamper',b=>{b[12+b.readUInt32BE(8)]^=1}],
  ['magic tamper',b=>{b[0]^=1}],
]) test('reject '+name,()=>fixture(({key,ctx,data})=>{const b=sealSyntheticBackup(data,ctx,key);mutate(b);assert.throws(()=>openSyntheticBackup(b,key,ctx))}))
test('wrong key fails before any plaintext is returned',()=>fixture(({key,ctx,data})=>assert.throws(()=>openSyntheticBackup(sealSyntheticBackup(data,ctx,key),randomBytes(32),ctx))))
test('missing or invalid key rejected',()=>fixture(({ctx,data})=>{for(const k of [undefined,Buffer.alloc(16),'secret'])assert.throws(()=>sealSyntheticBackup(data,ctx,k))}))
for(const size of [0,5,12,40,-1]) test('truncated archive length '+size+' rejected',()=>fixture(({key,ctx,data})=>{
  const b=sealSyntheticBackup(data,ctx,key);assert.throws(()=>openSyntheticBackup(b.subarray(0,size<0?b.length-1:size),key,ctx))
}))
test('appended content rejected',()=>fixture(({key,ctx,data})=>assert.throws(()=>openSyntheticBackup(Buffer.concat([sealSyntheticBackup(data,ctx,key),Buffer.from('extra')]),key,ctx))))
for(const [name,mutate] of [
  ['unknown format',h=>{h.format='other'}],['unknown version',h=>{h.version=2}],['unknown cipher',h=>{h.algorithm='AES-CBC'}],
  ['manifest component hash',h=>{h.components[0].sha256='0'.repeat(64)}],
  ['manifest component size',h=>{h.components[0].bytes+=1}],
  ['duplicate component',h=>{h.components.push(h.components[0])}],
  ['missing roles',h=>{h.components.pop()}],
  ['path traversal',h=>{h.components[0].name='../outside'}],
]) test('reject '+name,()=>fixture(({key,ctx,data})=>{
  const b=changeHeader(sealSyntheticBackup(data,ctx,key),mutate);assert.throws(()=>openSyntheticBackup(b,key,ctx))
}))
test('missing roles and unexpected components rejected at encryption',()=>fixture(({key,ctx,data})=>{
  assert.throws(()=>sealSyntheticBackup({'database.dump':data['database.dump']},ctx,key))
  assert.throws(()=>sealSyntheticBackup({...data,'extra.sql':Buffer.from('extra')},ctx,key))
  assert.throws(()=>sealSyntheticBackup({...data,'roles.sql':Buffer.alloc(0)},ctx,key))
}))
test('source commit, source hashes and run substitution rejected',()=>fixture(({key,ctx,data})=>{
  const b=sealSyntheticBackup(data,ctx,key)
  for(const c of [{...ctx,run:randomUUID()},{...ctx,sourceCommit:'c'.repeat(40)},{...ctx,sourceFiles:[{...ctx.sourceFiles[0],sha256:'d'.repeat(64)}]}])assert.throws(()=>openSyntheticBackup(b,key,c))
}))
test('invalid or duplicate source fingerprints rejected',()=>fixture(({key,ctx,data})=>{
  for(const sourceFiles of [[],[{file:'../outside',sha256:'b'.repeat(64)}],[ctx.sourceFiles[0],ctx.sourceFiles[0]],[{file:'a',sha256:'invalid'}]])assert.throws(()=>sealSyntheticBackup(data,{...ctx,sourceFiles},key))
}))
test('exclusive encrypted output verifies without plaintext files',()=>fixture(({root,key,ctx,data})=>{
  const b=sealSyntheticBackup(data,ctx,key), m=writeEncryptedSet(root,b,ctx)
  assert.deepEqual(readdirSync(root),['backup.spenc'])
  assert.equal(m.artifacts[0].sha256,sha256(readFileSync(join(root,'backup.spenc'))))
  assert.deepEqual(verifyEncryptedSet(root,m,key,ctx),data)
  assert.throws(()=>writeEncryptedSet(root,b,ctx))
}))
test('modified sidecar manifest rejected',()=>fixture(({root,key,ctx,data})=>{
  const m=writeEncryptedSet(root,sealSyntheticBackup(data,ctx,key),ctx)
  for(const mutate of [x=>{x.artifacts[0].sha256='0'.repeat(64)},x=>{x.extra='injected'},x=>{x.version=2},x=>{x.artifacts=[]},x=>{x.artifacts.push(x.artifacts[0])},x=>{x.artifacts[0].name='../outside'}]){
    const changed=structuredClone(m);mutate(changed);assert.throws(()=>verifyEncryptedSet(root,changed,key,ctx))
  }
}))
test('missing encrypted artifact rejected',()=>fixture(({root,key,ctx,data})=>{
  const m=writeEncryptedSet(root,sealSyntheticBackup(data,ctx,key),ctx)
  rmSync(join(root,'backup.spenc'));assert.throws(()=>verifyEncryptedSet(root,m,key,ctx))
}))
test('artifact replacement rejected even with recomputed untrusted checksum',()=>fixture(({root,key,ctx,data})=>{
  const m=writeEncryptedSet(root,sealSyntheticBackup(data,ctx,key),ctx), foreign={...ctx,run:randomUUID()}
  const b=sealSyntheticBackup(data,foreign,key);writeFileSync(join(root,'backup.spenc'),b)
  m.artifacts[0]={name:'backup.spenc',bytes:b.length,sha256:sha256(b)}
  assert.throws(()=>verifyEncryptedSet(root,m,key,ctx))
}))
test('hard-linked artifact rejected',()=>fixture(({root,key,ctx,data})=>{
  const m=writeEncryptedSet(root,sealSyntheticBackup(data,ctx,key),ctx)
  linkSync(join(root,'backup.spenc'),join(root,'alias'))
  assert.throws(()=>verifyEncryptedSet(root,m,key,ctx))
}))
test('directory/junction escape rejected',()=>fixture(({root,key,ctx,data})=>{
  const foreign=mkdtempSync(join(tmpdir(),'stock-encrypted-external-'))
  const alias=join(root,'escape')
  try{
    symlinkSync(foreign,alias,process.platform==='win32'?'junction':'dir')
    const blob=sealSyntheticBackup(data,ctx,key)
    assert.throws(()=>writeEncryptedSet(alias,blob,ctx))
  }finally{rmSync(foreign,{recursive:true})}
}))
test('artifact directory substituted for regular file rejected',()=>fixture(({root,key,ctx,data})=>{
  const m=writeEncryptedSet(root,sealSyntheticBackup(data,ctx,key),ctx)
  rmSync(join(root,'backup.spenc'));symlinkSync(root,join(root,'backup.spenc'),process.platform==='win32'?'junction':'dir')
  assert.throws(()=>verifyEncryptedSet(root,m,key,ctx))
}))
