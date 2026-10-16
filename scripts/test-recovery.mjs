import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { assertOwned, verifyManifest, assertInventory } from './qa/recovery-safety.mjs'
const expected = { run: 'synthetic-run', name: 'stock-recovery-synthetic-source', id: 'synthetic-id' }
const good = () => ({ Id: expected.id, Name: '/' + expected.name, Config: { Labels: { 'stock-portfolio.qa.run': expected.run, 'stock-portfolio.qa.purpose': 'recovery-v1370' } }, HostConfig: { NetworkMode: 'none', PortBindings: {}, Tmpfs: { '/var/lib/postgresql/data': 'rw', '/var/run/postgresql': 'rw', '/tmp': 'rw' } }, Mounts: [{ Type: 'tmpfs', Destination: '/var/lib/postgresql/data' }, { Type: 'tmpfs', Destination: '/var/run/postgresql' }, { Type: 'tmpfs', Destination: '/tmp' }] })
test('owned network-isolated tmpfs resource accepted', () => assertOwned(good(), expected))
for (const [name, mutate] of [
  ['foreign run', d => { d.Config.Labels['stock-portfolio.qa.run'] = 'other' }],
  ['missing label', d => { delete d.Config.Labels['stock-portfolio.qa.purpose'] }],
  ['reused name with different ID', d => { d.Id = 'prior-resource' }],
  ['network attached', d => { d.HostConfig.NetworkMode = 'bridge' }],
  ['host port', d => { d.HostConfig.PortBindings = { '5432/tcp': [{ HostPort: '54322' }] } }],
  ['persistent mount', d => { d.Mounts[0].Type = 'volume' }],
]) test(`refuse ${name}`, () => { const d = good(); mutate(d); assert.throws(() => assertOwned(d, expected)) })
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'stock-recovery-unit-'))
  const artifacts = ['database.dump', 'roles.sql'].map(name => { const data = Buffer.from('synthetic-' + name); writeFileSync(join(dir, name), data); return { name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') } })
  try { fn(dir, { artifacts }) } finally { rmSync(dir, { recursive: true }) }
}
test('complete backup set verifies', () => fixture((d, m) => verifyManifest(d, m)))
test('corrupt backup fails checksum', () => fixture((d, m) => { writeFileSync(join(d, 'database.dump'), 'corrupt'); assert.throws(() => verifyManifest(d, m)) }))
test('missing role artifact fails', () => fixture((d, m) => { rmSync(join(d, 'roles.sql')); assert.throws(() => verifyManifest(d, m)) }))
test('partial manifest cannot pass as complete', () => fixture((d, m) => { m.artifacts.pop(); assert.throws(() => verifyManifest(d, m)) }))
test('path traversal rejected', () => fixture((d, m) => { m.artifacts[0].name = '../outside'; assert.throws(() => verifyManifest(d, m)) }))
test('duplicate artifact rejected', () => fixture((d, m) => { m.artifacts.push(m.artifacts[0]); assert.throws(() => verifyManifest(d, m)) }))
test('restored row loss fails inventory check', () => assert.throws(() => assertInventory({ tables: [{ count: 3, hash: 'a' }] }, { tables: [{ count: 2, hash: 'b' }] })))
test('restored RLS/ACL change fails inventory check', () => assert.throws(() => assertInventory({ catalog: { hash: 'policy-a' } }, { catalog: { hash: 'policy-b' } })))
test('created container with declared tmpfs is accepted before start', () => { const d=good(); d.Mounts=[]; assertOwned(d, expected) })
test('undeclared volatile data path rejected', () => { const d=good(); delete d.HostConfig.Tmpfs['/var/lib/postgresql/data']; assert.throws(() => assertOwned(d, expected)) })
