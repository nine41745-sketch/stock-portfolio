import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))

function versionTuple(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '')
  assert.ok(match, `Expected a stable semantic version, received ${version}`)
  return match.slice(1).map(Number)
}

function assertAtLeast(actual, minimum, packageName) {
  const actualParts = versionTuple(actual)
  const minimumParts = versionTuple(minimum)
  const comparison = actualParts.findIndex((part, index) => part !== minimumParts[index])
  assert.ok(comparison === -1 || actualParts[comparison] > minimumParts[comparison], `${packageName} ${actual} is below the required security floor ${minimum}`)
}

const finance = lock.packages['node_modules/yahoo-finance2']
assert.ok(finance, 'yahoo-finance2 must remain present in the production dependency tree')
assertAtLeast(finance.version, '4.0.5', 'yahoo-finance2')
assert.ok(finance.integrity, 'yahoo-finance2 must keep an integrity hash in the lockfile')

const zodPackages = Object.entries(lock.packages)
  .filter(([packagePath]) => packagePath === 'node_modules/zod' || packagePath.endsWith('/node_modules/zod'))
assert.ok(zodPackages.length > 0, 'The production dependency tree must contain zod')
for (const [packagePath, packageInfo] of zodPackages) {
  assertAtLeast(packageInfo.version, '4.6.6', `${packagePath} zod`)
  assert.ok(packageInfo.integrity, `${packagePath} zod must keep an integrity hash in the lockfile`)
}

console.log(`Dependency security regression passed: yahoo-finance2 ${finance.version}; ${zodPackages.length} zod package(s) at or above 4.6.6.`)
