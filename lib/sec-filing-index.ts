export type SecFilingForm = '10-K' | '10-K/A' | '10-Q' | '10-Q/A' | '8-K' | '8-K/A'
export type SecFilingResolutionStatus = 'resolved' | 'missing' | 'unverified' | 'ambiguous'

export interface SecRecentFiling {
  cik: string
  accession: string
  form: SecFilingForm
  filingDate: string
  primaryDocument: string
  submissionsUrl: string
  sourceUrl: string
  contentAnalyzed: false
}

export interface SecFilingResolution {
  status: SecFilingResolutionStatus
  reason: string
  cik: string | null
  accession: string | null
  form: SecFilingForm | null
  primaryDocument: string | null
  sourceUrl: string | null
}

type JsonRecord = Record<string, unknown>
const CIK = /^\d{10}$/
const SUBMISSIONS_CIK = /^\d{1,10}$/
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/
const DOCUMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.html?$/i
const RECENT_FORMS = new Set<SecFilingForm>(['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A'])
const DATE = /^\d{4}-\d{2}-\d{2}$/

function validFilingDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function empty(status: SecFilingResolutionStatus, reason: string): SecFilingResolution {
  return { status, reason, cik: null, accession: null, form: null, primaryDocument: null, sourceUrl: null }
}

function normalizeSubmissionsCik(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
  return SUBMISSIONS_CIK.test(text) ? text.padStart(10, '0') : null
}

/** Normalize only recent issuer Submissions rows; the linked filing body is not analyzed here. */
export function selectSecRecentFilings(expectedCik: string, evidence: unknown): SecRecentFiling[] {
  if (!CIK.test(expectedCik)) return []
  const wrapper = asRecord(evidence)
  const requestUrl = wrapper?.requestUrl
  if (typeof requestUrl !== 'string') return []
  let parsedUrl: URL
  try { parsedUrl = new URL(requestUrl) } catch { return [] }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'data.sec.gov' ||
      (parsedUrl.port && parsedUrl.port !== '443') || parsedUrl.username || parsedUrl.password ||
      parsedUrl.search || parsedUrl.hash || parsedUrl.pathname !== `/submissions/CIK${expectedCik}.json`) return []
  const payload = asRecord(wrapper?.payload)
  if (normalizeSubmissionsCik(payload?.cik) !== expectedCik) return []
  const recent = asRecord(asRecord(payload?.filings)?.recent)
  const accessions = recent?.accessionNumber
  const forms = recent?.form
  const dates = recent?.filingDate
  const documents = recent?.primaryDocument
  if (!Array.isArray(accessions) || !Array.isArray(forms) || !Array.isArray(dates) || !Array.isArray(documents) ||
      accessions.length !== forms.length || accessions.length !== dates.length || accessions.length !== documents.length) return []
  const results: SecRecentFiling[] = []
  for (let index = 0; index < accessions.length; index += 1) {
    const accession = accessions[index]
    const form = forms[index]
    const filingDate = dates[index]
    const document = documents[index]
    if (typeof accession !== 'string' || !ACCESSION.test(accession) || typeof form !== 'string' ||
        !RECENT_FORMS.has(form as SecFilingForm) || typeof filingDate !== 'string' || !validFilingDate(filingDate) || typeof document !== 'string' ||
        !DOCUMENT.test(document) || document.includes('..') || document.includes('/') || document.includes('\\')) continue
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(expectedCik)}/${accession.replaceAll('-', '')}/`
    results.push({ cik: expectedCik, accession, form: form as SecFilingForm, filingDate, primaryDocument: document,
      submissionsUrl: requestUrl, sourceUrl: `${base}${encodeURIComponent(document)}`, contentAnalyzed: false })
  }
  return results.sort((a, b) => b.filingDate.localeCompare(a.filingDate) || b.accession.localeCompare(a.accession)).slice(0, 20)
}

/**
 * Locate a filing document only when issuer Submissions metadata and the issuer-scoped archive
 * index agree. `resolved` means a source document was located; it never verifies EPS content.
 */
export function resolveSecPrimaryDocument(
  expected: { cik: string; accession: string; form: SecFilingForm },
  submissionsEvidence: unknown,
  archiveIndex: unknown,
): SecFilingResolution {
  if (!CIK.test(expected.cik) || !ACCESSION.test(expected.accession) ||
      (expected.form !== '10-K' && expected.form !== '10-K/A')) {
    return empty('unverified', 'Expected CIK, accession or form is invalid')
  }

  const evidence = asRecord(submissionsEvidence)
  const requestUrl = evidence?.requestUrl
  if (typeof requestUrl !== 'string') return empty('unverified', 'SEC Submissions request provenance is unavailable')
  let submissionsUrl: URL
  try { submissionsUrl = new URL(requestUrl) } catch { return empty('unverified', 'SEC Submissions request provenance is invalid') }
  if (submissionsUrl.protocol !== 'https:' || submissionsUrl.hostname !== 'data.sec.gov' ||
      (submissionsUrl.port && submissionsUrl.port !== '443') || submissionsUrl.username || submissionsUrl.password ||
      submissionsUrl.search || submissionsUrl.hash || submissionsUrl.pathname !== `/submissions/CIK${expected.cik}.json`) {
    return empty('unverified', 'SEC Submissions request is not scoped to the expected issuer CIK')
  }
  const submissions = asRecord(evidence?.payload)
  const submissionsCik = normalizeSubmissionsCik(submissions?.cik)
  if (!submissionsCik) return empty('unverified', 'SEC Submissions issuer identity is unavailable')
  if (submissionsCik !== expected.cik) return empty('unverified', 'SEC Submissions metadata belongs to a different issuer CIK')
  const filings = asRecord(asRecord(submissions?.filings)?.recent)
  const accessions = filings?.accessionNumber
  const forms = filings?.form
  const documents = filings?.primaryDocument
  if (!Array.isArray(accessions) || !Array.isArray(forms) || !Array.isArray(documents) ||
      accessions.length !== forms.length || accessions.length !== documents.length) {
    return empty('unverified', 'SEC Submissions filing columns are missing or inconsistent')
  }
  const matchingIndexes = accessions.flatMap((value, index) => value === expected.accession ? [index] : [])
  if (matchingIndexes.length === 0) return empty('missing', 'No issuer Submissions row matches the accession')
  if (matchingIndexes.length !== 1) return empty('ambiguous', 'Multiple issuer Submissions rows match the accession')

  const index = matchingIndexes[0]
  if (forms[index] !== expected.form) return empty('unverified', 'SEC Submissions form does not match the selected EPS fact')
  const documentName = documents[index]
  if (typeof documentName !== 'string' || !DOCUMENT.test(documentName) ||
      documentName.includes('..') || documentName.includes('/') || documentName.includes('\\')) {
    return empty('unverified', 'SEC Submissions primaryDocument is missing or unsafe')
  }

  const root = asRecord(archiveIndex)
  const directory = asRecord(root?.directory)
  const directoryName = directory?.name
  const expectedDirectory = '/Archives/edgar/data/' + String(Number(expected.cik)) + '/' + expected.accession.replaceAll('-', '')
  if (typeof directoryName !== 'string' || directoryName.replace(/\/+$/, '') !== expectedDirectory) {
    return empty('unverified', 'SEC archive index is not bound to the expected issuer CIK and accession')
  }
  if (!Array.isArray(directory?.item)) return empty('unverified', 'SEC archive index document listing is unavailable')
  const exactEntries = directory.item.map(asRecord)
    .filter((item): item is JsonRecord => item !== null && item.name === documentName)
  if (exactEntries.length === 0) return empty('missing', 'SEC Submissions primaryDocument is not present in the accession archive index')
  if (exactEntries.length !== 1) return empty('ambiguous', 'SEC archive index lists the primaryDocument more than once')
  return {
    status: 'resolved',
    reason: 'Issuer Submissions CIK, accession, form and primaryDocument agree with the issuer-scoped archive index; EPS content is not verified',
    cik: expected.cik, accession: expected.accession, form: expected.form, primaryDocument: documentName,
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/' + String(Number(expected.cik)) + '/' +
      expected.accession.replaceAll('-', '') + '/' + encodeURIComponent(documentName),
  }
}
