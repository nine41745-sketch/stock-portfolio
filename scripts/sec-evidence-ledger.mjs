import fs from 'node:fs'
import path from 'node:path'

const endpointTypes = new Set(['mapping', 'companyfacts', 'filing'])
const redirectOutcomes = new Set(['none', 'rejected', 'followed', 'unknown'])
const requestOutcomes = new Set(['success', 'http_error', 'network_error', 'timeout', 'redirect_rejected', 'unknown'])
const caseStatuses = new Set(['pass', 'fail', 'blocked', 'unknown'])

export function createEvidenceLedger(mode = 'synthetic') {
  if (mode !== 'synthetic' && mode !== 'live') throw new Error('Unsupported evidence mode')
  return { mode, requests: [], acceptance: [] }
}

export function recordHttpRequest(ledger, event) {
  if (!endpointTypes.has(event?.endpointType) || !redirectOutcomes.has(event?.redirectOutcome) ||
      !requestOutcomes.has(event?.outcome) ||
      !(event?.httpStatus === null || (Number.isInteger(event.httpStatus) && event.httpStatus >= 100 && event.httpStatus <= 599))) {
    throw new Error('Invalid sanitized HTTP request event')
  }
  ledger.requests.push({
    endpointType: event.endpointType, httpStatus: event.httpStatus, retry: event.retry === true,
    redirectOutcome: event.redirectOutcome, outcome: event.outcome,
  })
}

export function recordAcceptance(ledger, item) {
  if (typeof item?.caseId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(item.caseId) ||
      !caseStatuses.has(item?.status)) throw new Error('Invalid acceptance result')
  ledger.acceptance.push({ caseId: item.caseId, status: item.status })
}

export function buildEvidenceArtifact(ledger, generatedAt = new Date().toISOString()) {
  if (ledger?.mode !== 'synthetic' && ledger?.mode !== 'live') throw new Error('Invalid evidence mode')
  const requests = ledger.requests.map(item => ({
    endpointType: item.endpointType, httpStatus: item.httpStatus, retry: item.retry,
    redirectOutcome: item.redirectOutcome, outcome: item.outcome,
  }))
  const acceptance = ledger.acceptance.map(item => ({ caseId: item.caseId, status: item.status }))
  return {
    schemaVersion: 1, generatedAt, evidenceMode: ledger.mode, httpRequestCount: requests.length,
    retryCount: requests.filter(item => item.retry).length, requests, acceptance,
  }
}

export function writeEvidenceArtifact(ledger, root = process.cwd()) {
  const directory = path.join(root, '.local-artifacts')
  fs.mkdirSync(directory, { recursive: true })
  const suffix = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(directory, 'sec-filing-verification-' + suffix + '.json')
  fs.writeFileSync(filePath, JSON.stringify(buildEvidenceArtifact(ledger), null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  return filePath
}
