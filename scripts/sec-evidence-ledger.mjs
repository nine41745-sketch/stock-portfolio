import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const endpointTypes = new Set(['mapping', 'companyfacts', 'submissions', 'filing_index', 'filing_document', 'filing'])
const redirectOutcomes = new Set(['none', 'rejected', 'followed', 'unknown'])
const requestOutcomes = new Set(['pending', 'success', 'http_error', 'network_error', 'timeout', 'redirect_rejected', 'unknown'])
const caseStatuses = new Set(['pass', 'fail', 'blocked', 'unknown'])

export function createEvidenceLedger(mode = 'synthetic', maxHttpAttempts = 5) {
  if (mode !== 'synthetic' && mode !== 'live') throw new Error('Unsupported evidence mode')
  if (!Number.isInteger(maxHttpAttempts) || maxHttpAttempts < 1 || maxHttpAttempts > 10) {
    throw new Error('Invalid HTTP attempt budget')
  }
  return { mode, maxHttpAttempts, requests: [], acceptance: [] }
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
    schemaVersion: 1, generatedAt, evidenceMode: ledger.mode, maxHttpAttempts: ledger.maxHttpAttempts,
    httpRequestCount: requests.length, remainingHttpAttempts: Math.max(0, ledger.maxHttpAttempts - requests.length),
    retryCount: requests.filter(item => item.retry).length, requests, acceptance,
  }
}

/** Writes each checkpoint as a new ignored artifact; wx prevents replacing existing evidence. */
export function writeEvidenceArtifact(ledger, root = process.cwd(), suffix = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`) {
  if (!/^[A-Za-z0-9-]{1,100}$/.test(suffix)) throw new Error('Invalid artifact suffix')
  const directory = path.join(root, '.local-artifacts')
  fs.mkdirSync(directory, { recursive: true })
  const filePath = path.join(directory, 'sec-filing-verification-' + suffix + '.json')
  fs.writeFileSync(filePath, JSON.stringify(buildEvidenceArtifact(ledger), null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  return filePath
}

function classifyEndpoint(rawUrl) {
  let url
  try { url = new URL(rawUrl) } catch { throw new Error('Unsupported SEC endpoint') }
  if (url.protocol !== 'https:' || (url.hostname !== 'www.sec.gov' && url.hostname !== 'data.sec.gov') ||
      (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash) {
    throw new Error('Unsupported SEC endpoint')
  }
  if (url.hostname === 'www.sec.gov' && url.pathname === '/files/company_tickers_exchange.json') return 'mapping'
  if (url.hostname === 'data.sec.gov' && /^\/api\/xbrl\/companyfacts\/CIK\d{10}\.json$/.test(url.pathname)) return 'companyfacts'
  if (url.hostname === 'data.sec.gov' && /^\/submissions\/CIK\d{10}\.json$/.test(url.pathname)) return 'submissions'
  const archive = url.hostname === 'www.sec.gov' && url.pathname.match(/^\/Archives\/edgar\/data\/(?:0|[1-9]\d{0,9})\/(\d{18})\/(.+)$/)
  if (archive && archive[2] === 'index.json') return 'filing_index'
  if (archive && /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.html?$/i.test(archive[2]) && !archive[2].includes('..')) {
    return 'filing_document'
  }
  throw new Error('Unsupported SEC endpoint')
}

/**
 * Wraps an injected fetcher. It records a sanitized pending checkpoint before each actual fetcher
 * call and a completion checkpoint afterward. URL and request init remain transient in memory only.
 */
export function createLedgerFetch(ledger, fetcher, persist = current => writeEvidenceArtifact(current)) {
  if (!ledger || !Number.isInteger(ledger.maxHttpAttempts) || ledger.maxHttpAttempts < 1 ||
      !Array.isArray(ledger.requests) || typeof fetcher !== 'function' || typeof persist !== 'function') {
    throw new Error('Invalid ledger fetch configuration')
  }
  const seen = new Set()
  return async (url, init) => {
    const endpointType = classifyEndpoint(url)
    if (ledger.requests.length >= ledger.maxHttpAttempts) throw new Error('SEC request attempt budget exhausted')
    const retry = seen.has(url)
    seen.add(url)
    const event = { endpointType, httpStatus: null, retry, redirectOutcome: 'unknown', outcome: 'pending' }
    const eventIndex = ledger.requests.length
    recordHttpRequest(ledger, event)
    persist(ledger)
    let response
    try {
      response = await fetcher(url, init)
    } catch (error) {
      const name = error && typeof error === 'object' ? error.name : ''
      ledger.requests[eventIndex].outcome = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error'
      persist(ledger)
      throw error
    }
    ledger.requests[eventIndex].httpStatus = response.status
    ledger.requests[eventIndex].redirectOutcome = response.status >= 300 && response.status < 400 ? 'rejected' : 'none'
    ledger.requests[eventIndex].outcome = response.status >= 200 && response.status < 300 ? 'success' :
      response.status >= 300 && response.status < 400 ? 'redirect_rejected' : 'http_error'
    persist(ledger)
    return response
  }
}
