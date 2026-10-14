export type SecFilingForm = '10-K' | '10-K/A'
export type SecFilingResolutionStatus = 'resolved' | 'missing' | 'unverified' | 'ambiguous'

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
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/
const DOCUMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.html?$/i

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function empty(status: SecFilingResolutionStatus, reason: string): SecFilingResolution {
  return { status, reason, cik: null, accession: null, form: null, primaryDocument: null, sourceUrl: null }
}

/** Resolve only explicit SEC accession/form/primaryDocument metadata confirmed by its archive index. */
export function resolveSecPrimaryDocument(
  expected: { cik: string; accession: string; form: SecFilingForm },
  filingRecords: unknown,
  archiveIndex: unknown,
): SecFilingResolution {
  if (!CIK.test(expected.cik) || !ACCESSION.test(expected.accession) ||
      expected.accession.slice(0, 10) !== expected.cik ||
      (expected.form !== '10-K' && expected.form !== '10-K/A')) {
    return empty('unverified', 'Expected CIK, accession or form is invalid')
  }
  if (!Array.isArray(filingRecords)) return empty('unverified', 'SEC filing metadata is unavailable')
  const matchingRecords = filingRecords.map(asRecord)
    .filter((item): item is JsonRecord => item !== null && item.accessionNumber === expected.accession)
  if (matchingRecords.length === 0) return empty('missing', 'No SEC filing metadata matches the accession')
  if (matchingRecords.length !== 1) return empty('ambiguous', 'Multiple SEC filing metadata rows match the accession')

  const filing = matchingRecords[0]
  if (filing.form !== expected.form) return empty('unverified', 'SEC filing form does not match the selected EPS fact')
  const documentName = filing.primaryDocument
  if (typeof documentName !== 'string' || !DOCUMENT.test(documentName) ||
      documentName.includes('..') || documentName.includes('/') || documentName.includes('\\')) {
    return empty('unverified', 'SEC primaryDocument is missing or unsafe')
  }

  const root = asRecord(archiveIndex)
  const directory = asRecord(root?.directory)
  const directoryName = directory?.name
  const expectedDirectory = '/Archives/edgar/data/' + String(Number(expected.cik)) + '/' + expected.accession.replaceAll('-', '')
  if (typeof directoryName !== 'string' || directoryName.replace(/\/+$/, '') !== expectedDirectory) {
    return empty('unverified', 'SEC archive index is not bound to the expected CIK and accession')
  }
  if (!Array.isArray(directory?.item)) return empty('unverified', 'SEC archive index document listing is unavailable')
  const exactEntries = directory.item.map(asRecord)
    .filter((item): item is JsonRecord => item !== null && item.name === documentName)
  if (exactEntries.length === 0) return empty('missing', 'SEC primaryDocument is not present in the accession archive index')
  if (exactEntries.length !== 1) return empty('ambiguous', 'SEC archive index lists the primaryDocument more than once')
  const listedType = exactEntries[0].type
  if (typeof listedType === 'string' && listedType && listedType !== expected.form) {
    return empty('unverified', 'Archive document type conflicts with SEC filing metadata')
  }

  return {
    status: 'resolved',
    reason: 'Accession, form and SEC primaryDocument metadata locate one file in the accession-scoped archive index',
    cik: expected.cik, accession: expected.accession, form: expected.form, primaryDocument: documentName,
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/' + String(Number(expected.cik)) + '/' +
      expected.accession.replaceAll('-', '') + '/' + encodeURIComponent(documentName),
  }
}
