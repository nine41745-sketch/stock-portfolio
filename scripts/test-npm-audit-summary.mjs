import assert from 'node:assert/strict'
import { renderAuditSummary } from './qa/summarize-npm-audit.mjs'

const report = {
  metadata: { vulnerabilities: { critical: 0, high: 2, moderate: 0, low: 0, info: 0 } },
  vulnerabilities: {
    braces: {
      severity: 'high', range: '<3.0.3', fixAvailable: false,
      via: [{ source: 12345, url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' }],
    },
  },
}
const npmTree = {
  name: 'stock-portfolio', dependencies: {
    tailwindcss: { version: '3.4.0', dependencies: { micromatch: { version: '4.0.0', dependencies: { braces: { version: '3.0.2' } } } } },
  },
}
const result = renderAuditSummary({ report, npmTree, exitCode: 1, mode: 'Full', commit: 'synthetic-sha' })
assert.equal(result.status, 'FINDINGS')
assert.match(result.markdown, /GHSA-vfj7-8cjw-p6xm/)
assert.match(result.markdown, /stock-portfolio > tailwindcss@3\.4\.0 > micromatch@4\.0\.0 > braces@3\.0\.2/)
assert.match(result.markdown, /no fix available/)
assert.doesNotMatch(result.markdown, /encrypted_password|SUPABASE_SERVICE_ROLE_KEY/)

const clean = renderAuditSummary({
  report: { metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 } }, vulnerabilities: {} },
  npmTree, exitCode: 0, mode: 'Production-only',
})
assert.equal(clean.status, 'PASS')

const blocked = renderAuditSummary({ report: { error: { code: 'ENOTFOUND' } }, npmTree: {}, exitCode: 1, mode: 'Full' })
assert.equal(blocked.status, 'BLOCKED')
assert.match(blocked.markdown, /ENOTFOUND/)

console.log('✓ Synthetic audit summary reports findings, dependency paths, fix metadata, clean and registry-blocked states')
