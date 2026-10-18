import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const SAFE_STAGE = /^[A-Z0-9_-]{1,80}$/
const RESULT_STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED', 'TIMEOUT'])

function safeStage(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) return 'UNKNOWN'
  const normalized = value.toUpperCase().replaceAll('-', '_')
  return SAFE_STAGE.test(normalized) ? normalized : 'UNKNOWN'
}

function atomicJsonSync(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, path)
}

export function readQaCheckpointSync(directory) {
  try {
    const value = JSON.parse(readFileSync(join(directory, 'runner-status.json'), 'utf8'))
    if (!value || typeof value !== 'object') return null
    return value
  } catch {
    return null
  }
}

export function writeQaCheckpointSync(directory, {
  stage,
  startedAtMs,
  stageStartedAtMs,
  passedChecks = [],
  stageHistory = [],
}, nowMs = Date.now()) {
  mkdirSync(directory, { recursive: true })
  const currentStage = safeStage(stage)
  const safeChecks = Array.isArray(passedChecks)
    ? passedChecks.filter(name => typeof name === 'string').slice(0, 500).map(name => name.slice(0, 180))
    : []
  const history = Array.isArray(stageHistory) ? stageHistory.slice(-100).map(item => ({
    stage: safeStage(item?.stage),
    enteredAt: typeof item?.enteredAt === 'string' ? item.enteredAt.slice(0, 40) : null,
    durationMs: Number.isFinite(item?.durationMs) ? Math.max(0, Math.round(item.durationMs)) : null,
  })) : []
  const checkpoint = {
    status: 'RUNNING',
    stage: currentStage,
    startedAt: Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : null,
    stageStartedAt: Number.isFinite(stageStartedAtMs) ? new Date(stageStartedAtMs).toISOString() : null,
    elapsedMs: Number.isFinite(startedAtMs) ? Math.max(0, Math.round(nowMs - startedAtMs)) : null,
    stageElapsedMs: Number.isFinite(stageStartedAtMs) ? Math.max(0, Math.round(nowMs - stageStartedAtMs)) : null,
    passedChecks: safeChecks.length,
    checks: safeChecks,
    stageHistory: history,
    updatedAt: new Date(nowMs).toISOString(),
  }
  atomicJsonSync(join(directory, 'runner-status.json'), checkpoint)
  return checkpoint
}

export function markQaStageSync(directory, stage, nowMs = Date.now()) {
  const previous = readQaCheckpointSync(directory)
  const history = Array.isArray(previous?.stageHistory) ? [...previous.stageHistory] : []
  if (previous?.stage && Number.isFinite(Date.parse(previous.stageStartedAt))) {
    history.push({
      stage: safeStage(previous.stage),
      enteredAt: previous.stageStartedAt,
      durationMs: Math.max(0, nowMs - Date.parse(previous.stageStartedAt)),
    })
  }
  const checkpoint = writeQaCheckpointSync(directory, {
    stage,
    startedAtMs: Number.isFinite(Date.parse(previous?.startedAt)) ? Date.parse(previous.startedAt) : nowMs,
    stageStartedAtMs: nowMs,
    passedChecks: previous?.checks ?? [],
    stageHistory: history,
  }, nowMs)
  console.log(`QA_STAGE ${JSON.stringify({ stage: checkpoint.stage, elapsedMs: checkpoint.elapsedMs })}`)
  return checkpoint
}

export function recordQaCheckSync(directory, stage, name, nowMs = Date.now()) {
  const previous = readQaCheckpointSync(directory)
  const checks = Array.isArray(previous?.checks) ? [...previous.checks] : []
  checks.push(String(name).slice(0, 180))
  return writeQaCheckpointSync(directory, {
    stage: stage ?? previous?.stage ?? 'UNKNOWN',
    startedAtMs: Number.isFinite(Date.parse(previous?.startedAt)) ? Date.parse(previous.startedAt) : nowMs,
    stageStartedAtMs: Number.isFinite(Date.parse(previous?.stageStartedAt)) ? Date.parse(previous.stageStartedAt) : nowMs,
    passedChecks: checks,
    stageHistory: previous?.stageHistory ?? [],
  }, nowMs)
}

export function recordInterruptedRunSync(directory, exitCode, nowMs = Date.now()) {
  const resultsPath = join(directory, 'results.json')
  try {
    const existing = JSON.parse(readFileSync(resultsPath, 'utf8'))
    if (RESULT_STATUSES.has(existing?.status)) return { written: false, status: existing.status }
  } catch {
    // Missing or incomplete results are replaced with bounded, sanitized evidence below.
  }

  const checkpoint = readQaCheckpointSync(directory)
  const timeout = exitCode === 124 || exitCode === 137 || exitCode === 'timeout'
  const stage = safeStage(checkpoint?.stage)
  const checks = Array.isArray(checkpoint?.checks) ? checkpoint.checks.filter(name => typeof name === 'string').slice(0, 500) : []
  const message = timeout
    ? 'The browser runner was terminated by its deadline supervisor or workflow cancellation before complete results.'
    : 'The browser runner stopped before writing complete results.'
  const result = {
    status: timeout ? 'TIMEOUT' : 'BLOCKED',
    environment: 'Disposable local Supabase loopback only',
    data: 'synthetic only',
    finalStage: stage,
    timeoutReason: timeout ? message : null,
    elapsedMs: Number.isFinite(checkpoint?.elapsedMs) ? checkpoint.elapsedMs : null,
    stageDurationMs: Number.isFinite(checkpoint?.stageElapsedMs) ? checkpoint.stageElapsedMs : null,
    stageHistory: Array.isArray(checkpoint?.stageHistory) ? checkpoint.stageHistory : [],
    checks: checks.map(name => ({ name, status: 'PASS' })),
    passedChecks: checks.length,
    failure: { stage, name: timeout ? 'TimeoutError' : 'RunnerStopped', message },
  }
  mkdirSync(directory, { recursive: true })
  atomicJsonSync(resultsPath, result)
  return { written: true, status: result.status, stage }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, directory, argument] = process.argv.slice(2)
  if (!directory) throw new Error('QA artifact directory is required')
  if (command === 'stage') markQaStageSync(directory, argument)
  else if (command === 'interrupted') {
    const exitCode = Number(argument)
    if (!Number.isInteger(exitCode)) throw new Error('A numeric runner exit code is required')
    const result = recordInterruptedRunSync(directory, exitCode)
    console.log(`QA_EVIDENCE ${JSON.stringify(result)}`)
  } else throw new Error('Unknown QA evidence command')
}
