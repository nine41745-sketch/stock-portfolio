import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (relativePath) => JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'))
const packageJson = readJson('package.json')
const rootLock = readJson('package-lock.json')
const inventory = readJson('scripts/lint/vendor-audit/inventory.json')
const vendorPackage = readJson('scripts/lint/vendor-audit/package.json')
const vendorLock = readJson('scripts/lint/vendor-audit/package-lock.json')
const canonicalTextBytes = (bytes) => Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

assert.equal(
  sha256(canonicalTextBytes(Buffer.from('first\r\nsecond\r\n'))),
  sha256(Buffer.from('first\nsecond\n')),
  'bundle integrity hashes are independent of Windows versus Unix line endings',
)

assert.equal(packageJson.devDependencies.oxlint, '1.90.0')
assert.equal(packageJson.devDependencies.eslint, undefined)
assert.equal(packageJson.devDependencies['eslint-config-next'], undefined)
assert.equal(rootLock.packages[''].devDependencies.oxlint, '1.90.0')
assert.equal(rootLock.packages['node_modules/oxlint'].version, '1.90.0')
assert.equal(Object.keys(rootLock.packages).some((key) => key === 'node_modules/eslint' || key.endsWith('/eslint')), false, 'root lock does not retain ESLint')
assert.equal(Object.keys(rootLock.packages).some((key) => key.endsWith('/minimatch')), false)
assert.equal(Object.keys(vendorLock.packages).some((key) => key.endsWith('/minimatch')), false, 'vendored lint audit does not retain minimatch')
assert.equal(Object.keys(vendorLock.packages).some((key) => key === 'node_modules/eslint'), false, 'vendored lint bundle audit excludes ESLint peer-only metadata')
assert.equal(Object.keys(vendorPackage.devDependencies).length, inventory.packages.length)
assert.equal(inventory.packages.length, 44)
assert.equal(vendorPackage.devDependencies['eslint-plugin-react'], undefined)

for (const dependency of inventory.packages) {
  assert.equal(vendorPackage.devDependencies[dependency.name], dependency.version, `${dependency.name} version is in the audit manifest`)
  const lockEntry = vendorLock.packages[`node_modules/${dependency.name}`]
  assert.ok(lockEntry, `${dependency.name} is present in the vendored audit lock`)
  assert.equal(lockEntry.version, dependency.version, `${dependency.name} version matches the bundle source lock`)
  assert.equal(lockEntry.integrity, dependency.integrity, `${dependency.name} integrity matches the bundle source lock`)
}

for (const [relativePath, expectedHash] of Object.entries(inventory.bundles)) {
  const bytes = readFileSync(path.join(root, 'scripts/lint', relativePath))
  const actualHash = sha256(canonicalTextBytes(bytes))
  assert.equal(actualHash, expectedHash, `${relativePath} hash matches its reviewed inventory`)
  assert.equal(bytes.includes(Buffer.from('minimatch')), false, `${relativePath} does not include minimatch`)
}

const config = readJson('.oxlintrc.json')
assert.deepEqual(config.jsPlugins.map((plugin) => plugin.specifier), [
  './scripts/lint/react-legacy-plugin.cjs',
  './scripts/lint/react-namespace-plugin.cjs',
  './scripts/lint/peerless-plugin.cjs',
])
for (const [category, state] of Object.entries(config.categories)) {
  assert.equal(state, 'off', `${category} remains opt-in; explicit rules preserve the prior lint baseline`)
}

console.log(`Vendored lint audit inventory: ${inventory.packages.length} packages verified; npm audit covers scripts/lint/vendor-audit/package-lock.json`)
