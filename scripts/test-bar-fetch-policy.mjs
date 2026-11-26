import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  DEFAULT_MIN_FALLBACK_BARS,
  DEFAULT_RETRY_BUDGET_MS,
  DEFAULT_RETRY_DELAYS_MS,
  fetchBarsWithStalenessPolicy,
  summarizeBarRetries,
} from '../lib/bar-fetch-policy.ts'
import { barLagSessions } from '../lib/market-status.ts'

// v1.41.57: a stale daily bar (the provider has not delivered the newest session yet when the cron runs) is re-fetched briefly, then a
// fallback source is tried, never past one shared deadline. Everything here is simulated, so no cron run is needed to test the behaviour.

const NOW = new Date('2026-11-26T02:07:49.612Z').getTime() // Wed 25 Nov 21:07 ET: the 25 Nov session is complete
const yahooDay = day => `${day}T14:30:00.000Z`
const stooqDay = day => `${day}T00:00:00.000Z`
const makeBars = (lastDay, count, stamp = yahooDay) => {
  const bars = []
  const base = Date.parse(`${lastDay}T00:00:00.000Z`)
  for (let i = count - 1; i >= 0; i -= 1) bars.push({ date: stamp(new Date(base - i * 86_400_000).toISOString().slice(0, 10)), close: 100 })
  return bars
}
const set = (lastDay, source = 'Yahoo Finance', count = 250, stamp = yahooDay, droppedLatestAt = null) => ({ bars: makeBars(lastDay, count, stamp), source, droppedLatestAt })
const EMPTY = { bars: [], source: 'unavailable', droppedLatestAt: null }

function harness({ primary, fallback = [], startAt = NOW, deadlineMs = DEFAULT_RETRY_BUDGET_MS }) {
  let clock = startAt
  const log = { primaryCalls: 0, fallbackCalls: 0, sleeps: [] }
  const deps = {
    fetchPrimary: async () => primary[Math.min(log.primaryCalls++, primary.length - 1)],
    fetchFallback: async () => fallback[Math.min(log.fallbackCalls++, fallback.length - 1)] ?? EMPTY,
    lagOf: lastBarAt => barLagSessions(lastBarAt, new Date(NOW)),
    sleep: async ms => { log.sleeps.push(ms); clock += ms },
    now: () => clock,
  }
  const options = { deadlineAt: startAt + deadlineMs, retryDelaysMs: DEFAULT_RETRY_DELAYS_MS, minFallbackBars: DEFAULT_MIN_FALLBACK_BARS }
  return { run: () => fetchBarsWithStalenessPolicy(deps, options), log, setClock: ms => { clock = ms } }
}
const last = result => result.bars.at(-1)?.date

// ---------- (a) data already correct: behaviour unchanged, no delay, no fallback ----------
{
  const h = harness({ primary: [set('2026-11-25')] })
  const r = await h.run()
  assert.equal(r.attempts, 1); assert.equal(r.lagSessions, 0); assert.equal(r.usedFallback, false)
  assert.equal(h.log.primaryCalls, 1); assert.equal(h.log.fallbackCalls, 0); assert.deepEqual(h.log.sleeps, [], 'a correct run is never delayed')
}

// ---------- (b) provider omits the newest day first, delivers on the retry ----------
{
  const h = harness({ primary: [set('2026-11-24'), set('2026-11-25')] })
  const r = await h.run()
  assert.equal(r.attempts, 2); assert.equal(r.lagSessions, 0); assert.equal(r.usedFallback, false)
  assert.equal(last(r), yahooDay('2026-11-25'), 'the newer retry result replaces the stale one')
  assert.deepEqual(h.log.sleeps, [6000]); assert.equal(h.log.fallbackCalls, 0, 'fallback is not needed once the retry is current')
}

// ---------- (c) delivers on the second retry ----------
{
  const h = harness({ primary: [set('2026-11-24'), set('2026-11-24'), set('2026-11-25')] })
  const r = await h.run()
  assert.equal(r.attempts, 3); assert.equal(r.lagSessions, 0)
  assert.deepEqual(h.log.sleeps, [6000, 8000], 'delays follow the configured schedule')
  assert.equal(h.log.fallbackCalls, 0)
}

// ---------- (d) always stale, fallback has the newest day and enough bars ----------
{
  const h = harness({ primary: [set('2026-11-24')], fallback: [set('2026-11-25', 'Stooq', 250, stooqDay)] })
  const r = await h.run()
  assert.equal(r.usedFallback, true); assert.equal(r.source, 'Stooq'); assert.equal(r.lagSessions, 0); assert.equal(r.attempts, 3)
  assert.equal(h.log.fallbackCalls, 1)
  assert.equal(last(r), stooqDay('2026-11-25'), 'the whole series comes from one source (never mixed)')
}

// ---------- (e) fallback not newer: keep the primary series ----------
{
  const h = harness({ primary: [set('2026-11-24')], fallback: [set('2026-11-24', 'Stooq', 250, stooqDay)] })
  const r = await h.run()
  assert.equal(r.usedFallback, false); assert.equal(r.source, 'Yahoo Finance'); assert.equal(r.lagSessions, 1)
}
{
  const h = harness({ primary: [set('2026-11-24')], fallback: [set('2026-11-20', 'Stooq', 250, stooqDay)] })
  const r = await h.run()
  assert.equal(r.usedFallback, false, 'an older fallback is never used'); assert.equal(r.lagSessions, 1)
}

// ---------- (f) fallback too short for EMA200 ----------
{
  const h = harness({ primary: [set('2026-11-24')], fallback: [set('2026-11-25', 'Stooq', 100, stooqDay)] })
  const r = await h.run()
  assert.equal(r.usedFallback, false, 'a fallback with fewer than 200 bars is rejected even if newer'); assert.equal(r.source, 'Yahoo Finance')
}

// ---------- (g) shared deadline ----------
{
  // less than the first delay left: no sleep, but the fallback may still run while time remains
  const h = harness({ primary: [set('2026-11-24')], fallback: [set('2026-11-25', 'Stooq', 250, stooqDay)], deadlineMs: 5000 })
  const r = await h.run()
  assert.deepEqual(h.log.sleeps, []); assert.equal(r.attempts, 1); assert.equal(r.deadlineReached, true); assert.equal(r.usedFallback, true)
}
{
  // deadline already passed: nothing at all beyond the first fetch
  const h = harness({ primary: [set('2026-11-24')], fallback: [set('2026-11-25', 'Stooq', 250, stooqDay)], deadlineMs: -1 })
  const r = await h.run()
  assert.deepEqual(h.log.sleeps, []); assert.equal(h.log.fallbackCalls, 0); assert.equal(r.attempts, 1); assert.equal(r.deadlineReached, true); assert.equal(r.usedFallback, false)
}
{
  // the second delay would cross the deadline (6000 + 8000 > 13000): only one retry
  const h = harness({ primary: [set('2026-11-24')], deadlineMs: 13000 })
  const r = await h.run()
  assert.deepEqual(h.log.sleeps, [6000]); assert.equal(r.attempts, 2); assert.equal(r.deadlineReached, true)
}
{
  // sleeping never goes past the deadline across the whole policy
  const h = harness({ primary: [set('2026-11-24')], fallback: [set('2026-11-24', 'Stooq', 250, stooqDay)], deadlineMs: DEFAULT_RETRY_BUDGET_MS })
  await h.run()
  assert.ok(h.log.sleeps.reduce((a, b) => a + b, 0) <= DEFAULT_RETRY_BUDGET_MS, 'total sleep stays within the shared budget')
}

// ---------- (h) nothing to compare: unknown lag is left alone ----------
{
  const h = harness({ primary: [EMPTY], fallback: [set('2026-11-25', 'Stooq', 250, stooqDay)] })
  const r = await h.run()
  assert.equal(r.attempts, 1); assert.equal(r.lagSessions, null); assert.equal(h.log.fallbackCalls, 0); assert.deepEqual(h.log.sleeps, [], 'no bars at all is handled by the existing Stooq fallback, not by this policy')
}

// ---------- (i) a retry that is not newer is not adopted; partial progress is kept ----------
{
  const h = harness({ primary: [set('2026-11-20'), set('2026-11-24'), set('2026-11-24')] })
  const r = await h.run()
  assert.equal(r.attempts, 3); assert.equal(r.lagSessions, 1, 'progress from 20 Nov to 24 Nov is kept')
  assert.equal(last(r), yahooDay('2026-11-24'))
}
{
  const h = harness({ primary: [set('2026-11-24'), set('2026-11-20'), set('2026-11-24')] })
  const r = await h.run()
  assert.equal(last(r), yahooDay('2026-11-24'), 'an older retry result never replaces a better one')
}
{
  const h = harness({ primary: [set('2026-11-24'), set('2026-11-20'), set('2026-11-20')] })
  const r = await h.run()
  assert.equal(last(r), yahooDay('2026-11-24'), 'worse retry results at the end never replace the better series')
  assert.equal(r.lagSessions, 1)
}
{
  const h = harness({ primary: [set('2026-11-24'), EMPTY, set('2026-11-24')] })
  const r = await h.run()
  assert.ok(r.bars.length > 0, 'an empty retry result never replaces data')
}

// ---------- (j) diagnostics are carried through ----------
{
  const h = harness({ primary: [set('2026-11-24', 'Yahoo Finance', 250, yahooDay, '2026-11-25T14:30:00.000Z')] })
  const r = await h.run()
  assert.equal(r.droppedLatestAt, '2026-11-25T14:30:00.000Z', 'the dropped-row date of the series actually used is returned')
}

// ---------- (k) log summary ----------
assert.deepEqual(summarizeBarRetries([]), [])
assert.deepEqual(summarizeBarRetries([{ symbol: 'AAA', attempts: 1, usedFallback: false, lagSessions: 0 }, { symbol: 'BBB' }]), [], 'symbols that needed no retry are not listed')
assert.deepEqual(summarizeBarRetries([{ symbol: 'AAA', attempts: 2, usedFallback: false, lagSessions: 0 }, { symbol: 'BBB', attempts: 3, usedFallback: true, lagSessions: 0 }, { symbol: 'CCC', attempts: 3, usedFallback: false, lagSessions: 1 }]),
  ['AAA:attempts=2:lag=0', 'BBB:attempts=3:lag=0:fallback', 'CCC:attempts=3:lag=1'])

// ---------- configuration sanity ----------
assert.ok(DEFAULT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) <= DEFAULT_RETRY_BUDGET_MS, 'the schedule fits the shared budget')
assert.ok(DEFAULT_RETRY_BUDGET_MS <= 20_000, 'the cron has 60 seconds and the AI call still has to run')
assert.equal(DEFAULT_MIN_FALLBACK_BARS, 200, 'EMA200 needs 200 bars')

// ---------- wiring: only the post-close cron turns the policy on ----------
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const indicators = read('lib/indicators.ts')
assert.ok(indicators.includes('retryDeadlineAt !== undefined && !context ? fetchBarsWithRetry(symbol, retryDeadlineAt) : fetchHistoricalBarsWithSource(symbol, context)'), 'the policy runs only when a deadline is given and there is no discovery context')
assert.ok(indicators.includes('fetchFallback: async () => ({ bars: await fetchFromStooq(toHistorySymbol(symbol)), source: \'Stooq\', droppedLatestAt: null })'), 'the fallback source is Stooq')
assert.ok(indicators.includes("const retryMeta = 'attempts' in barsFetch ?"), 'attempt metadata exists only when the policy ran')
assert.equal(indicators.split('...retryMeta').length - 1, 2, 'both returns carry the metadata')
assert.ok(indicators.includes('const closes = bars.map(b => b.close)'), 'indicator maths still uses every bar of the chosen series')
const daily = read('app/api/cron/daily-analyze/route.ts')
assert.ok(daily.includes('getTechnicalIndicators(holding.symbol, undefined, { retryDeadlineAt: barRetryDeadlineAt })'), 'daily cron enables the policy')
assert.ok(daily.includes('const barRetryDeadlineAt = Date.now() + DEFAULT_RETRY_BUDGET_MS') && daily.indexOf('const barRetryDeadlineAt') < daily.indexOf('const batchInputs'), 'one shared deadline is set before the parallel fetches')
for (const file of ['app/api/scanner/route.ts', 'app/api/discovery/route.ts', 'lib/stock-check-data.ts', 'lib/alerts-data.ts', 'app/api/analyze/route.ts', 'app/api/cron/premarket-analyze/route.ts']) {
  assert.ok(!read(file).includes('retryDeadlineAt'), `${file} must not enable the retry policy`)
}
assert.ok(read('app/api/cron/premarket-analyze/route.ts').includes('holding, technical: baseline.technical, earnings:'), 'pre-market still reuses the baseline indicators')
const policySource = read('lib/bar-fetch-policy.ts')
assert.ok(!/^\s*import\s/m.test(policySource), 'the policy module has no imports so it loads in the strip-types tests')

console.log('Bar fetch policy regression passed: retry, fallback, shared deadline and no-op when data is current')
