import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  if (includeEslint) tree.dependencies['eslint-config-next'] = { version: '16.4.1', dependencies: {
    '@next/eslint-plugin-next': { version: '16.4.1', dependencies: {
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

const describedRealShape = makeAudit()
const accepted = renderAuditSummary({ ...describedRealShape, exitCode: 1, mode: 'Full', commit: 'synthetic-shape' })
assert.equal(accepted.status, 'PASS_WITH_EXCEPTION')
assert.match(accepted.markdown, /GHSA-vfj7-8cjw-p6xm/)
assert.match(accepted.markdown, /tailwindcss@3\.4\.19 > chokidar@3\.6\.0 > braces@3\.0\.3/)
assert.match(accepted.markdown, /eslint-config-next@16\.4\.1 > @next\/eslint-plugin-next@16\.4\.1 > fast-glob@3\.3\.1/)

assert.equal(renderAuditSummary({ ...makeAudit({ extraAdvisory: true }), exitCode: 1, mode: 'Full' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...makeAudit({ critical: 1 }), exitCode: 1, mode: 'Full' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...makeAudit({ nonMajorFix: true }), exitCode: 1, mode: 'Full' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...makeAudit({ invalidPath: true }), exitCode: 1, mode: 'Full' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...describedRealShape, exitCode: 1, mode: 'Production-only' }).status, 'FINDINGS')
assert.equal(renderAuditSummary({ ...makeAudit({ includeEslint: false }), exitCode: 1, mode: 'Full' }).status, 'PASS_WITH_EXCEPTION')

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

console.log('✓ Audit exception classifier covers the owner-provided npm audit JSON shape and fails closed on unrelated findings')
