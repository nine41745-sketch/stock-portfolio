import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { createLedgerFetch, buildEvidenceArtifact, createEvidenceLedger, recordAcceptance, writeEvidenceArtifact } from './sec-evidence-ledger.mjs'

function loadTypeScript(fileName) {
  const source = fs.readFileSync(fileName, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
    fileName, reportDiagnostics: true,
  })
  assert.equal((compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0)
  return import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'))
}

const verifier = await loadTypeScript('lib/sec-filing-index.ts')
const sec = await loadTypeScript('lib/sec-xbrl.ts')

function fixture(cik, accession, form, primaryDocument) {
  const normalizedCik = String(Number(cik))
  const archivePath = `/Archives/edgar/data/${normalizedCik}/${accession.replaceAll('-', '')}`
  return {
    expected: { cik, accession, form },
    submissions: {
      requestUrl: `https://data.sec.gov/submissions/CIK${cik}.json`,
      payload: { cik: Number(cik),
      filings: { recent: {
        accessionNumber: [accession], form: [form], primaryDocument: [primaryDocument],
      } },
      },
    },
    archive: { directory: { name: archivePath, item: [
      { name: primaryDocument, type: 'text' }, { name: 'exhibit-23.htm', type: 'text' },
    ] } },
  }
}

const aapl = fixture('0000320193', '0000320193-25-000079', '10-K', 'aapl-20250927.htm')
const aaplResult = verifier.resolveSecPrimaryDocument(aapl.expected, aapl.submissions, aapl.archive)
assert.equal(aaplResult.status, 'resolved', 'AAPL issuer CIK and accession prefix may match')
assert.equal(aaplResult.primaryDocument, 'aapl-20250927.htm')
assert.equal(aaplResult.sourceUrl, 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm')
assert.match(aaplResult.reason, /EPS content is not verified/)

const msft = fixture('0000789019', '0001193125-26-323660', '10-K', 'msft-20260630.htm')
const msftResult = verifier.resolveSecPrimaryDocument(msft.expected, msft.submissions, msft.archive)
assert.equal(msftResult.status, 'resolved', 'MSFT filer accession prefix can differ from issuer CIK')
assert.equal(msftResult.cik, '0000789019')
assert.equal(msftResult.accession, '0001193125-26-323660')
assert.match(msftResult.sourceUrl, /\/Archives\/edgar\/data\/789019\/000119312526323660\//)

assert.equal(verifier.resolveSecPrimaryDocument(aapl.expected,
  { ...aapl.submissions, payload: { ...aapl.submissions.payload, cik: 789019 } }, aapl.archive).status, 'unverified', 'Wrong issuer Submissions CIK fails closed')
assert.equal(verifier.resolveSecPrimaryDocument(aapl.expected,
  { ...aapl.submissions, requestUrl: 'https://data.sec.gov/submissions/CIK0000789019.json' }, aapl.archive).status,
  'unverified', 'Submissions request URL must be scoped to the expected issuer CIK')
assert.equal(verifier.resolveSecPrimaryDocument(aapl.expected,
  { ...aapl.submissions, payload: { ...aapl.submissions.payload,
    filings: { recent: { ...aapl.submissions.payload.filings.recent, accessionNumber: ['0000320193-25-000080'] } } } }, aapl.archive).status, 'missing')
assert.equal(verifier.resolveSecPrimaryDocument(aapl.expected,
  { ...aapl.submissions, payload: { ...aapl.submissions.payload,
    filings: { recent: { ...aapl.submissions.payload.filings.recent, form: ['10-K/A'] } } } }, aapl.archive).status, 'unverified', 'Form mismatch fails closed')
assert.equal(verifier.resolveSecPrimaryDocument(aapl.expected,
  { ...aapl.submissions, payload: { ...aapl.submissions.payload,
    filings: { recent: { accessionNumber: [aapl.expected.accession], form: ['10-K'] } } } }, aapl.archive).status,
  'unverified', 'Missing primaryDocument column fails closed')
assert.equal(verifier.resolveSecPrimaryDocument(aapl.expected,
  { ...aapl.submissions, payload: { ...aapl.submissions.payload, filings: { recent: { ...aapl.submissions.payload.filings.recent,
    primaryDocument: ['../aapl.htm'] } } } }, aapl.archive).status, 'unverified', 'Unsafe primaryDocument is rejected')
assert.equal(verifier.resolveSecPrimaryDocument(aapl.expected,
  { ...aapl.submissions, payload: { ...aapl.submissions.payload, filings: { recent: { ...aapl.submissions.payload.filings.recent,
    accessionNumber: [aapl.expected.accession, aapl.expected.accession], form: ['10-K', '10-K'],
    primaryDocument: ['aapl.htm', 'aapl.htm'] } } } }, aapl.archive).status, 'ambiguous', 'Duplicate accession is ambiguous')
assert.equal(verifier.resolveSecPrimaryDocument(aapl.expected, aapl.submissions, {
  directory: { ...aapl.archive.directory, name: '/Archives/edgar/data/789019/000032019325000079' },
}).status, 'unverified', 'Archive issuer directory must match expected CIK')
assert.equal(verifier.resolveSecPrimaryDocument(aapl.expected, aapl.submissions, {
  directory: { ...aapl.archive.directory, name: '/Archives/edgar/data/320193/000032019325000080' },
}).status, 'unverified', 'Archive accession directory must match exact accession')
assert.equal(verifier.resolveSecPrimaryDocument(aapl.expected, aapl.submissions, {
  directory: { ...aapl.archive.directory, item: aapl.archive.directory.item.filter(item => item.name !== 'aapl-20250927.htm') },
}).status, 'missing', 'Primary document must exist in the archive listing')
assert.equal(verifier.resolveSecPrimaryDocument(aapl.expected, aapl.submissions, {
  directory: { ...aapl.archive.directory, item: [...aapl.archive.directory.item, { name: 'aapl-20250927.htm', type: 'text' }] },
}).status, 'ambiguous', 'Duplicate archive document entry is ambiguous')

const amended = fixture('0000320193', '0000320193-25-000080', '10-K/A', 'aapl-amended.htm')
assert.equal(verifier.resolveSecPrimaryDocument(amended.expected, amended.submissions, amended.archive).status, 'resolved',
  '10-K/A resolves only when issuer Submissions declares it')
assert.equal(verifier.resolveSecPrimaryDocument({ ...amended.expected, form: '10-K' }, amended.submissions, amended.archive).status,
  'unverified', '10-K/A cannot satisfy a 10-K expectation')
assert.equal('epsVerified' in aaplResult, false, 'Resolved filing is not represented as EPS Verified')
assert.equal(aaplResult.status, 'resolved')

const ledger = createEvidenceLedger('synthetic')
for (const caseId of ['aapl-matching-prefix', 'msft-different-prefix', 'wrong-issuer-cik', 'accession-form-mismatch',
  'primary-missing-duplicate-unsafe', 'archive-directory-mismatch', 'ten-k-amendment', 'resolved-not-eps-verified']) {
  recordAcceptance(ledger, { caseId, status: 'pass' })
}

const checkpointPaths = []
const persist = current => checkpointPaths.push(writeEvidenceArtifact(current))
const mockFetcher = async () => new Response('{"synthetic":true}', { status: 200, headers: { 'content-type': 'application/json' } })
const wrappedFetch = createLedgerFetch(ledger, mockFetcher, persist)
const userAgent = 'Synthetic Test Contact test@example.invalid'
const success = await sec.fetchSecJson('https://www.sec.gov/files/company_tickers_exchange.json', userAgent,
  wrappedFetch, async () => {}, { deadlineAt: Date.now() + 5000, timeoutMs: 1000 })
assert.equal(success.status, 'available')
assert.equal(ledger.requests.length, 1)
assert.deepEqual(checkpointPaths.map(file => JSON.parse(fs.readFileSync(file, 'utf8')).requests.at(-1).outcome), ['pending', 'success'],
  'Attempt is persisted before request and updated after response')
for (const artifactPath of checkpointPaths) {
  execFileSync('git', ['check-ignore', '-q', artifactPath], { stdio: 'ignore' })
}

const retryLedger = createEvidenceLedger('synthetic')
const retryCheckpointPaths = []
let retryCalls = 0
const retryFetch = createLedgerFetch(retryLedger, async () => {
  retryCalls += 1
  return new Response(retryCalls === 1 ? '' : '{"synthetic":true}', { status: retryCalls === 1 ? 503 : 200 })
}, current => retryCheckpointPaths.push(writeEvidenceArtifact(current)))
const retried = await sec.fetchSecJson('https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json', userAgent,
  retryFetch, async () => {}, { deadlineAt: Date.now() + 5000, timeoutMs: 1000 })
assert.equal(retried.status, 'available')
assert.equal(retryLedger.requests.length, 2)
assert.deepEqual(retryLedger.requests.map(item => item.retry), [false, true])
assert.deepEqual(retryLedger.requests.map(item => item.httpStatus), [503, 200])
assert.deepEqual(retryCheckpointPaths.map(file => JSON.parse(fs.readFileSync(file, 'utf8')).httpRequestCount), [1, 1, 2, 2],
  'Each attempt has a durable pre-call and post-response checkpoint')

const timeoutLedger = createEvidenceLedger('synthetic')
let timeoutCalls = 0
const timeoutFetch = createLedgerFetch(timeoutLedger, async () => {
  timeoutCalls += 1
  const error = new Error('synthetic timeout')
  error.name = 'TimeoutError'
  throw error
}, () => {})
const timedOut = await sec.fetchSecJson('https://data.sec.gov/api/xbrl/companyfacts/CIK0000789019.json', userAgent,
  timeoutFetch, async () => {}, { deadlineAt: Date.now() + 5000, timeoutMs: 1000 })
assert.equal(timedOut.status, 'provider_error')
assert.equal(timeoutCalls, 1, 'Timeout is not retried')
assert.equal(timeoutLedger.requests[0].outcome, 'timeout')
assert.equal(timeoutLedger.requests[0].httpStatus, null)

const endpointCases = [
  ['mapping', 'https://www.sec.gov/files/company_tickers_exchange.json'],
  ['companyfacts', 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json'],
  ['submissions', 'https://data.sec.gov/submissions/CIK0000320193.json'],
  ['filing_index', 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/index.json'],
  ['filing_document', 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl.htm'],
]
for (const [endpointType, url] of endpointCases) {
  const endpointLedger = createEvidenceLedger('synthetic', 1)
  let calls = 0
  const wrapped = createLedgerFetch(endpointLedger, async () => {
    calls += 1
    return new Response('{}', { status: 200 })
  }, () => {})
  await wrapped(url, { redirect: 'error' })
  assert.equal(endpointLedger.requests[0].endpointType, endpointType)
  assert.equal(calls, 1)
}

const budgetLedger = createEvidenceLedger('synthetic', 1)
let budgetCalls = 0
const budgetFetch = createLedgerFetch(budgetLedger, async () => {
  budgetCalls += 1
  return new Response('{}', { status: 200 })
}, () => {})
await budgetFetch('https://data.sec.gov/submissions/CIK0000320193.json', {})
await assert.rejects(budgetFetch('https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json', {}),
  /attempt budget exhausted/)
assert.equal(budgetCalls, 1, 'Exhausted budget blocks before the next network call')
assert.equal(budgetLedger.requests.length, 1, 'Only actual fetcher calls consume the attempt budget')
assert.equal(buildEvidenceArtifact(budgetLedger).remainingHttpAttempts, 0)

await assert.rejects(createLedgerFetch(ledger, mockFetcher)('https://www.sec.gov.evil.invalid/files/company_tickers_exchange.json', {}),
  /Unsupported SEC endpoint/)
assert.equal(ledger.requests.length, 1, 'Rejected host is not counted as an HTTP attempt')
await assert.rejects(createLedgerFetch(ledger, mockFetcher)('https://data.sec.gov/submissions/CIK0000320193.json.evil', {}),
  /Unsupported SEC endpoint/)

const probe = createEvidenceLedger('synthetic')
probe.requests.push({ endpointType: 'filing', httpStatus: 200, retry: false, redirectOutcome: 'none', outcome: 'success',
  url: 'https://secret.invalid/path', headers: { 'User-Agent': 'SYNTHETIC-CONTACT-MUST-NOT-LEAK' },
  email: 'synthetic@example.invalid', apiKey: 'SYNTHETIC-KEY-MUST-NOT-LEAK', body: 'SYNTHETIC-BODY-MUST-NOT-LEAK' })
const sanitizedProbe = JSON.stringify(buildEvidenceArtifact(probe, '2026-10-14T00:00:00.000Z'))
assert.doesNotMatch(sanitizedProbe, /secret\.invalid|SYNTHETIC-CONTACT|synthetic@example|SYNTHETIC-KEY|SYNTHETIC-BODY/)
assert.equal(JSON.parse(sanitizedProbe).httpRequestCount, 1)
assert.equal(JSON.parse(sanitizedProbe).retryCount, 0)

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-ledger-test-'))
try {
  const artifactPath = writeEvidenceArtifact(ledger, tempRoot, 'no-overwrite')
  assert.match(path.basename(artifactPath), /^sec-filing-verification-.+\.json$/)
  execFileSync('git', ['check-ignore', '-q', path.resolve('.local-artifacts', 'synthetic-ignore-probe.json')], { stdio: 'ignore' })
  const before = fs.readFileSync(artifactPath, 'utf8')
  assert.throws(() => writeEvidenceArtifact(probe, tempRoot, 'no-overwrite'), error => error.code === 'EEXIST',
    'Existing artifact name is never overwritten')
  assert.equal(fs.readFileSync(artifactPath, 'utf8'), before)
  const artifact = JSON.parse(before)
  assert.equal(artifact.evidenceMode, 'synthetic')
  assert.equal(artifact.httpRequestCount, 1, 'Local synthetic run records only its one mock HTTP call')
  assert.equal(artifact.acceptance.length, 8)
  assert.ok(artifact.acceptance.every(item => item.status === 'pass'))
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log('✓ SEC Submissions binding, issuer/accession independence, and redacted mock-fetch ledger regressions passed; zero live HTTP requests')
