import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { buildEvidenceArtifact, createEvidenceLedger, recordAcceptance, recordHttpRequest, writeEvidenceArtifact } from './sec-evidence-ledger.mjs'

const source = fs.readFileSync('lib/sec-filing-index.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
  fileName: 'lib/sec-filing-index.ts', reportDiagnostics: true,
})
assert.equal((compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0)
const verifier = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'))
const expected = { cik: '0000320193', accession: '0000320193-25-000079', form: '10-K' }
const filingRows = [{ accessionNumber: expected.accession, form: '10-K', primaryDocument: 'aapl-20250927.htm' }]
const index = { directory: { name: '/Archives/edgar/data/320193/000032019325000079/', item: [
  { name: 'aapl-20250927.htm', type: '10-K' },
  { name: 'aapl-20250927.xsd', type: 'SCHEMA' },
  { name: 'exhibit-23.htm', type: 'EX-23' },
] } }

const selected = verifier.resolveSecPrimaryDocument(expected, filingRows, index)
assert.equal(selected.status, 'resolved', 'Explicit primaryDocument is selected among multiple filing files')
assert.equal(selected.primaryDocument, 'aapl-20250927.htm')
assert.equal(selected.sourceUrl, 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm')
assert.equal(verifier.resolveSecPrimaryDocument(expected, filingRows, {
  ...index, directory: { ...index.directory, item: index.directory.item.slice(1) },
}).status, 'missing', 'Missing primary document fails closed')
assert.equal(verifier.resolveSecPrimaryDocument(expected, [], index).status, 'missing')
assert.equal(verifier.resolveSecPrimaryDocument(expected, [...filingRows, { ...filingRows[0] }], index).status, 'ambiguous')
const amended = { ...expected, form: '10-K/A' }
const amendedRows = [{ accessionNumber: amended.accession, form: '10-K/A', primaryDocument: 'aapl-10ka.htm' }]
const amendedIndex = { directory: { name: index.directory.name, item: [{ name: 'aapl-10ka.htm', type: '10-K/A' }] } }
assert.equal(verifier.resolveSecPrimaryDocument(amended, amendedRows, amendedIndex).status, 'resolved',
  '10-K/A resolves only against matching accession and form')
assert.equal(verifier.resolveSecPrimaryDocument(expected, amendedRows, amendedIndex).status, 'unverified',
  'An amendment cannot satisfy an expected original 10-K')
assert.equal(verifier.resolveSecPrimaryDocument(expected, filingRows, {
  directory: { ...index.directory, item: [{ name: 'aapl-20250927.htm', type: '10-K/A' }] },
}).status, 'unverified', 'Archive document type must agree with explicit filing form')
assert.equal(verifier.resolveSecPrimaryDocument({ ...expected, accession: '0000320193-25-000080' }, filingRows, index).status, 'missing')
assert.equal(verifier.resolveSecPrimaryDocument(expected, filingRows, {
  directory: { ...index.directory, name: '/Archives/edgar/data/320193/000032019325000080', item: index.directory.item },
}).status, 'unverified', 'Archive path must bind the exact accession')
assert.equal(verifier.resolveSecPrimaryDocument(expected,
  [{ ...filingRows[0], primaryDocument: '../aapl-20250927.htm' }], index).status, 'unverified')
assert.equal(verifier.resolveSecPrimaryDocument(expected, filingRows, {
  directory: { ...index.directory, item: [...index.directory.item, { name: 'aapl-20250927.htm', type: '10-K' }] },
}).status, 'ambiguous')

const ledger = createEvidenceLedger('synthetic')
for (const caseId of ['multi-document-primary', 'primary-missing', 'amended-10ka', 'ambiguous-metadata', 'accession-binding', 'index-form-conflict']) {
  recordAcceptance(ledger, { caseId, status: 'pass' })
}
const probe = createEvidenceLedger('synthetic')
recordHttpRequest(probe, {
  endpointType: 'filing', httpStatus: 200, retry: false, redirectOutcome: 'none', outcome: 'success',
  url: 'https://secret.invalid/path', userAgent: 'SYNTHETIC-CONTACT-MUST-NOT-LEAK',
  email: 'synthetic@example.invalid', apiKey: 'SYNTHETIC-KEY-MUST-NOT-LEAK',
})
const sanitizedProbe = JSON.stringify(buildEvidenceArtifact(probe, '2026-10-14T00:00:00.000Z'))
assert.doesNotMatch(sanitizedProbe, /secret\.invalid|SYNTHETIC-CONTACT|synthetic@example|SYNTHETIC-KEY/)
assert.equal(JSON.parse(sanitizedProbe).httpRequestCount, 1)
assert.equal(JSON.parse(sanitizedProbe).retryCount, 0)

const artifactPath = writeEvidenceArtifact(ledger)
assert.match(path.basename(artifactPath), /^sec-filing-verification-.+\.json$/)
execFileSync('git', ['check-ignore', '-q', artifactPath], { stdio: 'ignore' })
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
assert.equal(artifact.evidenceMode, 'synthetic')
assert.equal(artifact.httpRequestCount, 0, 'Synthetic regression run sends no HTTP requests')
assert.equal(artifact.acceptance.length, 6)
assert.ok(artifact.acceptance.every(item => item.status === 'pass'))
console.log('✓ SEC filing-index and redacted request-ledger synthetic regressions passed; zero live HTTP requests')
