import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderAuditSummary } from './qa/summarize-npm-audit.mjs'

const bracesAdvisory = {
  source: 1240992,
  name: 'braces',
  dependency: 'braces',
  title: 'braces vulnerable to stack-exhaustion denial of service through deeply nested patterns',
  url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  severity: 'high',
  range: '<=3.0.3',
}

function makeAudit({ extraAdvisory = false, critical = 0, nonMajorFix = false, invalidPath = false, includeEslint = true } = {}) {
  const dependencyLinks = {
    braces: [bracesAdvisory],
    chokidar: ['braces'],
    micromatch: ['braces'],
    tailwindcss: ['chokidar', 'micromatch'],
  }
  if (includeEslint) Object.assign(dependencyLinks, {
    'fast-glob': ['micromatch'],
    '@next/eslint-plugin-next': ['fast-glob'],
    'eslint-config-next': ['@next/eslint-plugin-next'],
  })
  const vulnerabilities = Object.fromEntries(Object.entries(dependencyLinks).map(([name, via]) => [name, {
    name, severity: 'high', isDirect: false, range: '*', via,
  }]))
  Object.assign(vulnerabilities.braces, {
    effects: ['chokidar', 'micromatch'],
    nodes: ['node_modules/braces'],
  })
  vulnerabilities.braces.fixAvailable = nonMajorFix
    ? { name: 'braces', version: '3.0.4', isSemVerMajor: false }
    : { name: 'tailwindcss', version: '4.3.3', isSemVerMajor: true }

  if (extraAdvisory) {
    vulnerabilities.micromatch.via.push({ source: 99999, name: 'micromatch', url: 'https://github.com/advisories/GHSA-other-1234-5678', severity: 'high', range: '<4.0.0' })
  }

  const braces = { version: '3.0.3' }
  const tree = {
    name: invalidPath ? 'other-project' : 'stock-portfolio',
    dependencies: {
      tailwindcss: { version: '3.4.19', dependencies: {
        chokidar: { version: '3.6.0', dependencies: { braces } },
        'fast-glob': { version: '3.3.3', dependencies: { micromatch: { version: '4.0.8', dependencies: { braces } } } },
        micromatch: { version: '4.0.8', dependencies: { braces } },
      } },
    },
  }
  if (includeEslint) tree.dependencies['eslint-config-next'] = { version: '16.4.5', dependencies: {
    '@next/eslint-plugin-next': { version: '16.4.5', dependencies: {
      'fast-glob': { version: '3.3.1', dependencies: {
          // npm ls --json can omit a deduped child edge although audit.via reports
          // fast-glob -> micromatch -> braces and the installed tree resolves it.
          micromatch: { version: '4.0.8' },
      } },
    } },
  } }
  const high = Object.keys(vulnerabilities).length
  return {
    report: {
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical, total: high + critical } },
      vulnerabilities,
    },
    npmTree: tree,
  }
}

// GHSA-vfj7-8cjw-p6xm was withdrawn by GitHub on 2026-10-23 and its CI exception was removed in v1.41.26.
// The old braces-shaped report must now fail closed instead of being accepted.
const describedRealShape = makeAudit()
const formerlyAccepted = renderAuditSummary({ ...describedRealShape, exitCode: 1, mode: 'Full', commit: 'synthetic-shape' })
assert.equal(formerlyAccepted.status, 'FINDINGS')
assert.ok(!/Accepted exception/i.test(formerlyAccepted.markdown), 'A braces report must not be reported as an accepted exception')
assert.match(formerlyAccepted.markdown, /GHSA-vfj7-8cjw-p6xm/)
assert.match(formerlyAccepted.markdown, /tailwindcss@3\.4\.19 > chokidar@3\.6\.0 > braces@3\.0\.3/)
assert.equal(renderAuditSummary({ ...describedRealShape, exitCode: 0, mode: 'Full' }).status, 'FINDINGS')

assert.equal(renderAuditSummary({ ...makeAudit({ extraAdvisory: true }), exitCode: 1, mode: 'Full' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...makeAudit({ critical: 1 }), exitCode: 1, mode: 'Full' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...makeAudit({ nonMajorFix: true }), exitCode: 1, mode: 'Full' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...makeAudit({ invalidPath: true }), exitCode: 1, mode: 'Full' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...describedRealShape, exitCode: 1, mode: 'Production-only' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...makeAudit({ includeEslint: false }), exitCode: 1, mode: 'Full' }).status, 'FINDINGS')

const clean = renderAuditSummary({
  report: { metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 } }, vulnerabilities: {} },
  npmTree: describedRealShape.npmTree, exitCode: 0, mode: 'Production-only',
})
assert.equal(clean.status, 'PASS')

const blocked = renderAuditSummary({ report: { error: { code: 'ENOTFOUND' } }, npmTree: {}, exitCode: 1, mode: 'Full' })
assert.equal(blocked.status, 'BLOCKED')

const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8')
assert.match(ciWorkflow, /npm audit --omit=dev --audit-level=high --json/)
assert.match(ciWorkflow, /\[ "\$PRODUCTION_AUDIT_STATUS" != "PASS" \]/)
assert.match(ciWorkflow, /\[ "\$FULL_AUDIT_STATUS" != "PASS_WITH_EXCEPTION" \]/)

console.log('✓ Audit classifier no longer accepts the withdrawn braces advisory and fails closed on every braces-shaped report')

function makeMinimatchAdvisory(range) {
  return {
    source: 9999999,
    name: 'minimatch',
    dependency: 'minimatch',
    url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
    severity: 'moderate',
    range,
  }
}

function makeMinimatchAudit({ extraAdvisory = false, productionNode = false, nonDevAncestor = false, packageRange = '<11.0.1', advisoryRange = '<11.0.1' } = {}) {
  const vulnerabilities = {
    minimatch: {
      name: 'minimatch', severity: 'moderate', isDirect: false, range: packageRange,
      via: [makeMinimatchAdvisory(advisoryRange)], effects: ['eslint'], nodes: ['node_modules/minimatch'], fixAvailable: true,
    },
    eslint: {
      name: 'eslint', severity: 'moderate', isDirect: false, range: '*',
      via: ['minimatch', 'eslint'], effects: [], nodes: ['node_modules/eslint'], fixAvailable: true,
    },
  }
  const tree = {
    name: 'stock-portfolio',
    dependencies: {
      eslint: { version: '9.39.5', dependencies: { minimatch: { version: '10.2.6' } } },
    },
  }
  const packages = {
    '': { name: 'stock-portfolio', version: '1.41.17' },
    'node_modules/eslint': { version: '9.39.5', dev: !nonDevAncestor },
    'node_modules/minimatch': { version: '10.2.6', dev: !productionNode },
  }
  if (extraAdvisory) {
    vulnerabilities.glob = {
      name: 'glob', severity: 'moderate', isDirect: false, range: '<11',
      via: [{ name: 'glob', url: 'https://github.com/advisories/GHSA-other-1111-2222', severity: 'moderate', range: '<11' }],
      effects: [], nodes: ['node_modules/glob'], fixAvailable: true,
    }
    tree.dependencies.glob = { version: '10.4.5' }
    packages['node_modules/glob'] = { version: '10.4.5', dev: true }
  }
  const count = Object.keys(vulnerabilities).length
  return {
    report: {
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: count, high: 0, critical: 0, total: count } },
      vulnerabilities,
    },
    npmTree: tree,
    packageLock: { packages },
  }
}

// The minimatch exception (GHSA-g3hv-75wg-m249) was removed in v1.41.42 after the ESLint toolchain moved to
// minimatch 11.0.1 or later. Every formerly accepted minimatch-shaped report must now fail closed.
const minimatchOnly = makeMinimatchAudit()
const minimatchFormerlyAccepted = renderAuditSummary({ ...minimatchOnly, exitCode: 0, mode: 'Full', now: '2026-12-15' })
assert.equal(minimatchFormerlyAccepted.status, 'FINDINGS')
assert.match(minimatchFormerlyAccepted.markdown, /GHSA-g3hv-75wg-m249/i)
assert.ok(!/ข้อยกเว้นที่ยอมรับ/.test(minimatchFormerlyAccepted.markdown), 'A minimatch report must not be reported as an accepted exception')
assert.equal(renderAuditSummary({ ...minimatchOnly, exitCode: 0, mode: 'Full', now: '2026-11-01' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...minimatchOnly, exitCode: 1, mode: 'Full' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...minimatchOnly, exitCode: 0, mode: 'Production-only' }).status, 'FINDINGS')
for (const [packageRange, advisoryRange] of [
  ['<11.0.1', '<11.0.1'],
  ['7.0.0 - 11.0.0', '>=7.0.0 <11.0.1'],
  ['*', '*'],
]) {
  for (const mode of ['Full', 'Production-only']) {
    assert.equal(
      renderAuditSummary({ ...makeMinimatchAudit({ packageRange, advisoryRange }), exitCode: 0, mode, now: '2026-12-15' }).status,
      'FINDINGS',
      `minimatch-shaped report must fail closed (${mode}: ${packageRange} / ${advisoryRange})`,
    )
  }
}

const installedLock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
for (const [lockPath, entry] of Object.entries(installedLock.packages)) {
  if (!lockPath.endsWith('node_modules/minimatch')) continue
  const major = Number(String(entry.version).split('.')[0])
  assert.ok(major < 7 || major > 11 || (major === 11 && entry.version !== '11.0.0'), `${lockPath}@${entry.version} is inside the GHSA-g3hv-75wg-m249 range (>=7.0.0 <11.0.1)`)
}
console.log('✓ Audit classifier no longer accepts the minimatch advisory and the lockfile holds no affected minimatch version')

// v1.41.44: time-boxed dev-only exception for picomatch GHSA-fc5q-39xc-vjpf (high, ReDoS, affected <= 4.0.7). npm has no
// patched picomatch release (latest is 4.0.7). The report below mirrors the structure of the real `npm audit --json`
// output (one advisory root, other packages reaching it through string `via` links, npm audit exit code 1).
const PICOMATCH_ADVISORY_URL = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf'

function makePicomatchAudit({
  extraAdvisory = false, extraModerate = false, orphanCycle = false, productionNode = false, nonDevAncestor = false,
  packageRange = '*', advisoryRange = '<=4.0.7', advisorySeverity = 'high', advisoryUrl = PICOMATCH_ADVISORY_URL, withLock = true,
  secondAdvisoryOnPicomatch = false, foreignViaObject = false, viaOutsideSet = false, emptyTree = false, duplicateNonDevLock = false,
  nodesEmpty = false, unknownNodePath = false, picomatchDevMissing = false, totalMismatch = false,
} = {}) {
  const links = {
    micromatch: ['picomatch'],
    'fast-glob': ['micromatch'],
    tailwindcss: ['micromatch', 'fast-glob'],
    fdir: ['picomatch'],
    tinyglobby: ['fdir', 'picomatch'],
    '@typescript-eslint/typescript-estree': ['tinyglobby'],
    'typescript-eslint': ['@typescript-eslint/typescript-estree'],
    'eslint-config-next': ['typescript-eslint'],
  }
  const nodesOf = {
    picomatch: ['node_modules/picomatch', 'node_modules/tinyglobby/node_modules/picomatch'],
    fdir: ['node_modules/tinyglobby/node_modules/fdir'],
  }
  const vulnerabilities = {
    picomatch: {
      name: 'picomatch', severity: 'high', isDirect: false, range: packageRange, effects: ['micromatch', 'fdir', 'tinyglobby'],
      via: [{ source: 1241234, name: 'picomatch', dependency: 'picomatch', title: 'picomatch vulnerable to ReDoS', url: advisoryUrl, severity: advisorySeverity, range: advisoryRange }],
      nodes: nodesOf.picomatch, fixAvailable: { name: 'tailwindcss', version: '4.3.5', isSemVerMajor: true },
    },
  }
  for (const [name, via] of Object.entries(links)) {
    vulnerabilities[name] = {
      name, severity: 'high', isDirect: name === 'tailwindcss' || name === 'eslint-config-next', range: '*', via, effects: [],
      nodes: nodesOf[name] ?? ['node_modules/' + name], fixAvailable: true,
    }
  }
  const tree = {
    name: 'stock-portfolio',
    dependencies: {
      tailwindcss: { version: '3.4.19', dependencies: {
        micromatch: { version: '4.0.8', dependencies: { picomatch: { version: '2.3.2' } } },
        'fast-glob': { version: '3.3.3', dependencies: { micromatch: { version: '4.0.8', dependencies: { picomatch: { version: '2.3.2' } } } } },
      } },
      'eslint-config-next': { version: '16.4.5', dependencies: {
        'typescript-eslint': { version: '8.73.0', dependencies: {
          '@typescript-eslint/typescript-estree': { version: '8.73.0', dependencies: {
            tinyglobby: { version: '0.2.17', dependencies: { fdir: { version: '6.5.0', dependencies: { picomatch: { version: '4.0.7' } } }, picomatch: { version: '4.0.7' } } },
          } },
        } },
      } },
    },
  }
  const dev = !nonDevAncestor
  const packages = {
    '': { name: 'stock-portfolio', version: '1.41.44' },
    'node_modules/tailwindcss': { version: '3.4.19', dev },
    'node_modules/micromatch': { version: '4.0.8', dev: true },
    'node_modules/fast-glob': { version: '3.3.3', dev: true },
    'node_modules/picomatch': { version: '2.3.2', dev: !productionNode },
    'node_modules/eslint-config-next': { version: '16.4.5', dev: true },
    'node_modules/typescript-eslint': { version: '8.73.0', dev: true },
    'node_modules/@typescript-eslint/typescript-estree': { version: '8.73.0', dev: true },
    'node_modules/tinyglobby': { version: '0.2.17', dev: true },
    'node_modules/tinyglobby/node_modules/fdir': { version: '6.5.0', dev: true },
    'node_modules/tinyglobby/node_modules/picomatch': { version: '4.0.7', dev: true },
  }
  if (extraAdvisory) {
    vulnerabilities.glob = {
      name: 'glob', severity: 'high', isDirect: false, range: '<11',
      via: [{ name: 'glob', url: 'https://github.com/advisories/GHSA-other-1111-2222', severity: 'high', range: '<11' }],
      effects: [], nodes: ['node_modules/glob'], fixAvailable: true,
    }
    tree.dependencies.glob = { version: '10.4.5' }
    packages['node_modules/glob'] = { version: '10.4.5', dev: true }
  }
  if (orphanCycle) {
    vulnerabilities.alpha = { name: 'alpha', severity: 'high', isDirect: false, range: '*', via: ['beta'], effects: [], nodes: ['node_modules/alpha'], fixAvailable: true }
    vulnerabilities.beta = { name: 'beta', severity: 'high', isDirect: false, range: '*', via: ['alpha'], effects: [], nodes: ['node_modules/beta'], fixAvailable: true }
    tree.dependencies.alpha = { version: '1.0.0' }
    tree.dependencies.beta = { version: '1.0.0' }
    packages['node_modules/alpha'] = { version: '1.0.0', dev: true }
    packages['node_modules/beta'] = { version: '1.0.0', dev: true }
  }
  const high = Object.keys(vulnerabilities).length
  const moderate = extraModerate ? 1 : 0
  if (extraModerate) {
    vulnerabilities.lodash = {
      name: 'lodash', severity: 'moderate', isDirect: false, range: '<4.17.21',
      via: [{ name: 'lodash', url: 'https://github.com/advisories/GHSA-other-3333-4444', severity: 'moderate', range: '<4.17.21' }],
      effects: [], nodes: ['node_modules/lodash'], fixAvailable: true,
    }
    tree.dependencies.lodash = { version: '4.17.20' }
    packages['node_modules/lodash'] = { version: '4.17.20', dev: true }
  }
  if (secondAdvisoryOnPicomatch) {
    vulnerabilities.picomatch.via.push({ source: 9999, name: 'picomatch', url: 'https://github.com/advisories/GHSA-zzzz-yyyy-xxxx', severity: 'high', range: '*' })
  }
  if (foreignViaObject) {
    vulnerabilities.micromatch.via.push({ name: 'micromatch', url: 'https://github.com/advisories/GHSA-other-5555-6666', severity: 'high', range: '*' })
  }
  if (viaOutsideSet) vulnerabilities.micromatch.via.push('left-pad')
  if (emptyTree) tree.dependencies = {}
  if (duplicateNonDevLock) packages['node_modules/other/node_modules/micromatch'] = { version: '4.0.8', dev: false }
  if (nodesEmpty) vulnerabilities.fdir.nodes = []
  if (unknownNodePath) vulnerabilities.fdir.nodes = ['vendor/fdir']
  if (picomatchDevMissing) delete packages['node_modules/picomatch'].dev
  return {
    report: { metadata: { vulnerabilities: { info: 0, low: 0, moderate, high, critical: 0, total: high + moderate + (totalMismatch ? 1 : 0) } }, vulnerabilities },
    npmTree: tree,
    ...(withLock ? { packageLock: { packages } } : {}),
  }
}

const picomatchOnly = makePicomatchAudit()
const picomatchOptions = { exitCode: 1, mode: 'Full', now: '2026-12-17' }
const picomatchAccepted = renderAuditSummary({ ...picomatchOnly, ...picomatchOptions })
assert.equal(picomatchAccepted.status, 'PASS_WITH_EXCEPTION')
assert.match(picomatchAccepted.markdown, /GHSA-FC5Q-39XC-VJPF/)
assert.match(picomatchAccepted.markdown, /แพ็กเกจที่ได้รับผลกระทบ 9 รายการ/)
assert.match(picomatchAccepted.markdown, /dev-only/i)
assert.match(picomatchAccepted.markdown, /2026-12-17/)
assert.match(picomatchAccepted.markdown, /ลบข้อยกเว้นนี้เมื่อมี picomatch รุ่นที่แก้/)

// Every other condition must keep failing closed.
const failClosed = (label, audit, options = picomatchOptions) =>
  assert.equal(renderAuditSummary({ ...audit, ...options }).status, 'FINDINGS', `picomatch exception must fail closed: ${label}`)
failClosed('expired one day after the expiry date', picomatchOnly, { ...picomatchOptions, now: '2026-12-18' })
failClosed('invalid date', picomatchOnly, { ...picomatchOptions, now: 'not-a-date' })
failClosed('npm audit exit code 0 with findings', picomatchOnly, { ...picomatchOptions, exitCode: 0 })
failClosed('npm error exit code 2', picomatchOnly, { ...picomatchOptions, exitCode: 2 })
failClosed('Production-only audit', picomatchOnly, { ...picomatchOptions, mode: 'Production-only' })
failClosed('another advisory in the report', makePicomatchAudit({ extraAdvisory: true }))
failClosed('a moderate finding in the report', makePicomatchAudit({ extraModerate: true }))
failClosed('a vulnerable package that does not reach picomatch', makePicomatchAudit({ orphanCycle: true }))
failClosed('picomatch installed as a production dependency', makePicomatchAudit({ productionNode: true }))
failClosed('a non-dev ancestor in the dependency chain', makePicomatchAudit({ nonDevAncestor: true }))
failClosed('advisory severity critical', makePicomatchAudit({ advisorySeverity: 'critical' }))
failClosed('different advisory id on picomatch', makePicomatchAudit({ advisoryUrl: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }))
failClosed('missing package-lock.json data', makePicomatchAudit({ withLock: false }))
for (const [packageRange, advisoryRange] of [
  ['*', '<=4.0.8'], ['*', '*'], ['*', '<4.0.7'], ['*', '>=2.0.0'], ['<=4.0.7', '<=4.0.7'], ['>=2.0.0', '<=4.0.7'], ['<5', '<=4.0.7'],
]) {
  failClosed(`unrecognized range spelling (${packageRange} / ${advisoryRange})`, makePicomatchAudit({ packageRange, advisoryRange }))
}
assert.equal(renderAuditSummary({
  report: { metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 } }, vulnerabilities: {} },
  npmTree: picomatchOnly.npmTree, exitCode: 0, mode: 'Full',
}).status, 'PASS')

// v1.41.45 (review of PR #189): fail-closed cases that had no test of their own, each already rejected by the classifier.
failClosed('a second advisory on picomatch', makePicomatchAudit({ secondAdvisoryOnPicomatch: true }))
failClosed('an advisory object in the via of a dependent package', makePicomatchAudit({ foreignViaObject: true }))
failClosed('a via entry pointing outside the vulnerable set', makePicomatchAudit({ viaOutsideSet: true }))
failClosed('empty dependency tree (the CI fallback when npm ls fails)', makePicomatchAudit({ emptyTree: true }))
failClosed('a duplicate lockfile entry with the same name and version that is not dev-only', makePicomatchAudit({ duplicateNonDevLock: true }))
failClosed('no affected nodes reported for a package', makePicomatchAudit({ nodesEmpty: true }))
failClosed('an unrecognized affected node path', makePicomatchAudit({ unknownNodePath: true }))
failClosed('picomatch lockfile entry without a dev flag', makePicomatchAudit({ picomatchDevMissing: true }))
failClosed('metadata total that does not match the report', makePicomatchAudit({ totalMismatch: true }))

// The advisory id is taken only from the exact GitHub advisory URL npm audit reports.
for (const advisoryUrl of [
  'https://evil.example/GHSA-fc5q-39xc-vjpf',
  'https://evil.example/advisories/GHSA-fc5q-39xc-vjpf',
  'https://github.com.evil.example/advisories/GHSA-fc5q-39xc-vjpf',
  'http://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  'https://github.com/advisories/notGHSA-fc5q-39xc-vjpf',
  'https://github.com/advisories/GHSA-fc5q-39xc-vjpf?ref=x',
  'https://github.com/advisories/GHSA-fc5q-39xc-vjpf/extra',
  'https://github.com/other/GHSA-fc5q-39xc-vjpf',
]) {
  failClosed(`advisory URL is not the exact GitHub advisory (${advisoryUrl})`, makePicomatchAudit({ advisoryUrl }))
}
for (const advisoryUrl of ['https://github.com/advisories/GHSA-fc5q-39xc-vjpf/', 'https://github.com/advisories/GHSA-FC5Q-39XC-VJPF']) {
  assert.equal(renderAuditSummary({ ...makePicomatchAudit({ advisoryUrl }), ...picomatchOptions }).status, 'PASS_WITH_EXCEPTION', `advisory URL spelling must stay accepted (${advisoryUrl})`)
}

// The expiry must come from the real clock when the caller supplies no `now` (the CLI never does).
function withFakeNow(iso, fn) {
  const RealDate = globalThis.Date
  const fixed = new RealDate(iso).getTime()
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(fixed); else super(...args) }
    static now() { return fixed }
  }
  globalThis.Date = FakeDate
  try { return fn() } finally { globalThis.Date = RealDate }
}
const statusAtClock = iso => withFakeNow(iso, () => renderAuditSummary({ ...picomatchOnly, exitCode: 1, mode: 'Full' }).status)
assert.equal(statusAtClock('2026-11-17T00:00:00Z'), 'PASS_WITH_EXCEPTION')
assert.equal(statusAtClock('2026-12-17T23:59:59Z'), 'PASS_WITH_EXCEPTION', 'The exception lasts until the end of 2026-12-17 (UTC)')
assert.equal(statusAtClock('2026-12-18T00:00:00Z'), 'FINDINGS', 'The exception must expire at the start of 2026-12-18 (UTC)')
assert.equal(statusAtClock('2027-06-01T00:00:00Z'), 'FINDINGS')

// The CLI path used by CI: real files, real argv, a faked clock, and a package-lock.json read from the working directory.
const cliScript = fileURLToPath(new URL('./qa/summarize-npm-audit.mjs', import.meta.url))
const cliDir = mkdtempSync(join(tmpdir(), 'audit-cli-'))
try {
  writeFileSync(join(cliDir, 'audit.json'), JSON.stringify(picomatchOnly.report))
  writeFileSync(join(cliDir, 'tree.json'), JSON.stringify(picomatchOnly.npmTree))
  writeFileSync(join(cliDir, 'package-lock.json'), JSON.stringify(picomatchOnly.packageLock))
  writeFileSync(join(cliDir, 'preload.cjs'), [
    "const RealDate = Date, fixed = new RealDate(process.env.FAKE_NOW).getTime()",
    "globalThis.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(fixed); else super(...a) } static now() { return fixed } }",
  ].join('\n'))
  const runCli = ({ mode = 'Full', exit = '1', now, cwd = cliDir } = {}) => {
    const result = spawnSync(process.execPath, ['--require', join(cliDir, 'preload.cjs'), cliScript, mode, join(cliDir, 'audit.json'), join(cliDir, 'tree.json'), exit, join(cliDir, 'out.md')], {
      cwd, env: { ...process.env, FAKE_NOW: now }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, `CLI must exit 0 (stderr: ${result.stderr})`)
    return result.stdout.trim()
  }
  assert.equal(runCli({ now: '2026-12-17T23:59:59Z' }), 'PASS_WITH_EXCEPTION')
  assert.equal(runCli({ now: '2026-12-18T00:00:00Z' }), 'FINDINGS')
  assert.equal(runCli({ now: '2026-11-17T00:00:00Z', mode: 'Production-only' }), 'FINDINGS')
  assert.equal(runCli({ now: '2026-11-17T00:00:00Z', exit: '0' }), 'FINDINGS')
  assert.equal(runCli({ now: '2026-11-17T00:00:00Z', exit: '2' }), 'FINDINGS')
  const noLockDir = mkdtempSync(join(tmpdir(), 'audit-cli-nolock-'))
  try {
    assert.equal(runCli({ now: '2026-11-17T00:00:00Z', cwd: noLockDir }), 'FINDINGS', 'The CLI must fail closed when package-lock.json cannot be read')
  } finally {
    rmSync(noLockDir, { recursive: true, force: true })
  }
} finally {
  rmSync(cliDir, { recursive: true, force: true })
}

// The classifier must define exactly one accepted advisory and nothing about the withdrawn braces or fixed minimatch ones.
const summarizerSource = readFileSync('scripts/qa/summarize-npm-audit.mjs', 'utf8')
assert.ok(!/minimatch|braces|vfj7|g3hv/i.test(summarizerSource), 'The audit classifier must not mention the removed minimatch or braces exceptions')
const advisoryIds = new Set((summarizerSource.match(/GHSA-[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9]+/g) ?? []).map(id => id.toUpperCase()))
assert.deepEqual([...advisoryIds], ['GHSA-FC5Q-39XC-VJPF'], 'Exactly one advisory may be accepted')
assert.match(summarizerSource, /acceptedPicomatchExpiry = '2026-12-17'/, 'The exception must carry its expiry date')
assert.match(summarizerSource, /exitCode !== 1/, 'Only npm audit exit code 1 may be accepted')
console.log('✓ picomatch GHSA-fc5q-39xc-vjpf exception is time-boxed, dev-only, Full-mode only and fails closed on every other condition')
