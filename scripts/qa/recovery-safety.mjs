import assert from 'node:assert/strict'
import { readFileSync, statSync, realpathSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'

export const sha256 = data => createHash('sha256').update(data).digest('hex')

// Only inspect/mutate IDs returned by this run's docker create, never discover by prefix alone.
export function assertOwned(resource, expected) {
  assert.ok(expected.run && expected.name && expected.id, 'Missing ownership receipt')
  assert.equal(resource.Id, expected.id, 'Container ID mismatch')
  assert.equal(resource.Name, '/' + expected.name, 'Container name mismatch')
  assert.equal(resource.Config?.Labels?.['stock-portfolio.qa.run'], expected.run, 'Foreign run')
  assert.equal(resource.Config?.Labels?.['stock-portfolio.qa.purpose'], 'recovery-v1370', 'Foreign purpose')
  assert.equal(resource.HostConfig?.NetworkMode, 'none', 'Network must be disabled')
  assert.equal(Object.keys(resource.HostConfig?.PortBindings ?? {}).length, 0, 'No host ports allowed')
  assert.deepEqual(Object.keys(resource.HostConfig?.Tmpfs ?? {}).sort(), ['/tmp', '/var/lib/postgresql/data', '/var/run/postgresql'].sort(), 'Expected declared tmpfs paths')
  for (const mount of resource.Mounts) {
    assert.equal(mount.Type, 'tmpfs', 'Persistent/bind mounts are forbidden')
    assert.ok(['/var/lib/postgresql/data', '/var/run/postgresql', '/tmp'].includes(mount.Destination), 'Unexpected mount')
  }
}

export function verifyManifest(root, manifest) {
  const artifacts = manifest.artifacts
  assert.ok(Array.isArray(artifacts), 'Missing artifact manifest')
  assert.deepEqual(artifacts.map(a => a.name).sort(), ['database.dump', 'roles.sql'], 'Incomplete or duplicate backup set')
  const base = realpathSync(root)
  for (const artifact of artifacts) {
    assert.match(artifact.name, /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/, 'Invalid artifact name')
    const path = resolve(base, artifact.name)
    assert.equal(dirname(realpathSync(path)), base, 'Artifact escapes backup root')
    assert.ok(statSync(path).isFile(), 'Artifact must be a file')
    assert.ok(artifact.bytes > 0, 'Empty backup is forbidden')
    assert.equal(statSync(path).size, artifact.bytes, 'Artifact size mismatch')
    assert.equal(sha256(readFileSync(path)), artifact.sha256, 'Artifact digest mismatch')
  }
}

export function assertInventory(expected, actual) {
  assert.deepEqual(actual, expected, 'Restored data/catalog differs from source')
}