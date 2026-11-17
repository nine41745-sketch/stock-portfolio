import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

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

const bodyParserPackages = Object.entries(lock.packages)
  .filter(([packagePath]) => packagePath === 'node_modules/body-parser' || packagePath.endsWith('/node_modules/body-parser'))
assert.ok(bodyParserPackages.length > 0, 'The production dependency tree must contain body-parser')
for (const [packagePath, packageInfo] of bodyParserPackages) {
  assertAtLeast(packageInfo.version, '2.4.0', `${packagePath} body-parser`)
  assert.notEqual(packageInfo.dev, true, `${packagePath} body-parser must remain a production dependency`)
  assert.ok(packageInfo.integrity, `${packagePath} body-parser must keep an integrity hash in the lockfile`)
}

const zodPackages = Object.entries(lock.packages)
  .filter(([packagePath]) => packagePath === 'node_modules/zod' || packagePath.endsWith('/node_modules/zod'))
assert.ok(zodPackages.length > 0, 'The production dependency tree must contain zod')
for (const [packagePath, packageInfo] of zodPackages) {
  assertAtLeast(packageInfo.version, '4.6.6', `${packagePath} zod`)
  assert.ok(packageInfo.integrity, `${packagePath} zod must keep an integrity hash in the lockfile`)
}

const fastUriPackages = Object.entries(lock.packages)
  .filter(([packagePath]) => packagePath === 'node_modules/fast-uri' || packagePath.endsWith('/node_modules/fast-uri'))
assert.ok(fastUriPackages.length > 0, 'The URI resolver used by AJV must remain covered')
for (const [packagePath, packageInfo] of fastUriPackages) {
  const patchedFloor = { 2: '2.4.8', 3: '3.1.9', 4: '4.2.3' }[versionTuple(packageInfo.version)[0]]
  assert.ok(patchedFloor, 'A new fast-uri major version requires security review')
  assertAtLeast(packageInfo.version, patchedFloor, `${packagePath} fast-uri`)
  assert.ok(packageInfo.integrity, `${packagePath} must keep its integrity hash`)
  const requireUri = createRequire(path.join(root, packagePath, 'package.json'))
  const uri = requireUri('./index.js')
  assert.equal(requireUri('./package.json').version, packageInfo.version, 'Installed URI resolver must match the lockfile')
  // GHSA-w74x-v6f9-j3xg: percent encoding must not create a live scheme.
  for (const input of ['%6Aavascript:alert(1)', '%u006Aavascript:alert(1)']) {
    assert.ok(uri.parse(input).error, 'An encoded scheme must be rejected')
  }
  assert.equal(uri.equal('%68ttp://a.example/', 'http://a.example/'), false)
  // GHSA-wjr9-j795-jxcr: canonicalization must not silently change authority.
  for (const input of ['http://a@b@evil.example/', 'http://exa\tmple.example/', 'http://exa\nmple.example/', 'http://exa\rmple.example/']) {
    assert.ok(uri.parse(input).error, 'Ambiguous hosts must be rejected')
  }
  // GHSA-xhq7-xmqj-769h: relative normalization must preserve resolution.
  for (const ref of ['../x', 'a/../b']) {
    assert.equal(uri.resolve('https://safe.example/dir/base', uri.normalize(ref)), uri.resolve('https://safe.example/dir/base', ref))
  }
  // GHSA-333x-w4r6-6crp: suffix references must not become active schemes.
  for (const input of ['javascript:alert(1)', 'data:text/plain,test', 'vbscript:msgbox(1)']) {
    // Match the upstream no-authority suffix fixture; suffix without a scheme
    // instead parses an authority and must be treated as an invalid URI.
    assert.equal(uri.parse(uri.normalize(input, { reference: 'suffix', scheme: 'x' })).scheme, undefined)
    assert.equal(uri.parse(uri.serialize({ path: input }, { reference: 'suffix' })).scheme, undefined)
    assert.ok(uri.parse(input, { reference: 'suffix' }).error)
  }
  assert.equal(uri.resolve('https://safe.example/schemas/base.json', '../item.json'), 'https://safe.example/item.json')
}

// Exercise AJV through the same resolver chain used by the production MCP SDK.
const requireSdk = createRequire(path.join(root, 'node_modules/@modelcontextprotocol/sdk/package.json'))
const Ajv = requireSdk('ajv')
const ajv = new Ajv()
ajv.addSchema({ $id: 'https://safe.example/schemas/value.json', type: 'integer', minimum: 1 })
const validate = ajv.compile({ $id: 'https://safe.example/schemas/main.json', type: 'object', properties: { count: { $ref: './value.json' } }, required: ['count'], additionalProperties: false })
assert.equal(validate({ count: 1 }), true, 'Ordinary relative schema references must still validate')
assert.equal(validate({ count: 0 }), false, 'URI update must not weaken AJV validation')

console.log(`Dependency security regression passed: yahoo-finance2 ${finance.version}; body-parser >=2.4.0; zod >=4.6.6; ${fastUriPackages.length} fast-uri copy/copies at patched major-specific floors with advisory and AJV behavior checks.`)
