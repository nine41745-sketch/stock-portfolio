import assert from 'node:assert/strict'
import fs from 'node:fs'
import { barFreshnessItem, barLagSessions, CALENDAR_LAST_YEAR, droppedLatestRowAt, lastCompletedSessionDate, summarizeStaleBars, tradingSessionsAfter } from '../lib/market-status.ts'

// v1.41.56: the daily bar behind the indicators must be measured against the last completed US session (ET calendar,
// NYSE holidays and early closes), never against the Thai calendar day. Measurement only: indicator values are not adjusted.

const at = iso => new Date(iso)
const YAHOO = day => `${day}T14:30:00.000Z` // Yahoo daily bars carry the session open (09:30 ET in EST)
const YAHOO_EDT = day => `${day}T13:30:00.000Z` // 09:30 ET in EDT

// ---------- last completed session ----------
assert.equal(lastCompletedSessionDate(at('2026-11-25T02:07:49.612Z')), '2026-11-24', 'Tue 21:07 ET: Tuesday has closed')
assert.equal(lastCompletedSessionDate(at('2026-11-25T14:16:53.961Z')), '2026-11-24', 'Wed 09:16 ET (pre-market): Wednesday has not closed')
assert.equal(lastCompletedSessionDate(at('2026-11-25T20:30:00.000Z')), '2026-11-24', 'Wed 15:30 ET: still the previous session')
assert.equal(lastCompletedSessionDate(at('2026-11-25T21:19:00.000Z')), '2026-11-24', 'Wed 16:19 ET: provider buffer of 20 minutes not over')
assert.equal(lastCompletedSessionDate(at('2026-11-25T21:20:00.000Z')), '2026-11-25', 'Wed 16:20 ET: the session bar should be complete')
assert.equal(lastCompletedSessionDate(at('2026-11-27T14:00:00.000Z')), '2026-11-25', 'Fri after Thanksgiving 09:00 ET: Thursday was a holiday')
assert.equal(lastCompletedSessionDate(at('2026-11-27T18:19:00.000Z')), '2026-11-25', 'Early close day 13:19 ET: buffer not over')
assert.equal(lastCompletedSessionDate(at('2026-11-27T18:20:00.000Z')), '2026-11-27', 'Early close day 13:20 ET: complete (13:00 close + 20 min)')
assert.equal(lastCompletedSessionDate(at('2026-11-28T15:00:00.000Z')), '2026-11-27', 'Saturday: Friday is the last session')
assert.equal(lastCompletedSessionDate(at('2026-11-29T15:00:00.000Z')), '2026-11-27', 'Sunday: Friday is the last session')
assert.equal(lastCompletedSessionDate(at('2026-11-30T13:00:00.000Z')), '2026-11-27', 'Monday 08:00 ET: before the open')
assert.equal(lastCompletedSessionDate(at('2026-07-14T21:00:00.000Z')), '2026-07-14', 'EDT Tue 17:00 ET (daylight saving)')
assert.equal(lastCompletedSessionDate(at('2026-07-14T20:10:00.000Z')), '2026-07-13', 'EDT Tue 16:10 ET: buffer not over')

// a long weekend + holiday + early week gap: Mon 2027-01-04 08:00 ET walks back over Sun, Sat, Fri (New Year holiday) to Thu 2026-12-31
assert.equal(lastCompletedSessionDate(at('2027-01-04T13:00:00.000Z')), '2026-12-31', 'a gap of four calendar days is still resolved')
assert.equal(lastCompletedSessionDate(at('2026-12-26T15:00:00.000Z')), '2026-12-24', 'Saturday after Christmas: Friday holiday, Thursday early close')

// ---------- sessions between days ----------
assert.equal(tradingSessionsAfter('2026-11-23', '2026-11-24'), 1)
assert.equal(tradingSessionsAfter('2026-11-24', '2026-11-24'), 0, 'same day is not behind')
assert.equal(tradingSessionsAfter('2026-11-25', '2026-11-24'), 0, 'a newer bar is not behind')
assert.equal(tradingSessionsAfter('2026-11-25', '2026-11-27'), 1, 'Thanksgiving holiday is not a session')
assert.equal(tradingSessionsAfter('2026-11-20', '2026-11-24'), 2, 'weekend is not a session')

// ---------- bar lag ----------
// the real 2026-11-25 post-close run: indicators ended on Mon 23 Nov although Tue 24 Nov had closed
assert.equal(barLagSessions(YAHOO('2026-11-23'), at('2026-11-25T02:07:49.612Z')), 1, 'post-close run with the Monday bar is one session behind')
assert.equal(barLagSessions(YAHOO('2026-11-24'), at('2026-11-25T02:07:49.612Z')), 0, 'post-close run with the Tuesday bar is current')
assert.equal(barLagSessions(YAHOO('2026-11-23'), at('2026-11-25T14:16:53.961Z')), 1, 'pre-market run still using the Monday bar is behind')
assert.equal(barLagSessions(YAHOO('2026-11-24'), at('2026-11-25T14:16:53.961Z')), 0, 'pre-market run with the Tuesday bar is current')
assert.equal(barLagSessions(YAHOO('2026-11-25'), at('2026-11-25T14:20:00.000Z')), 0, 'a partial bar of the running session is not behind')
assert.equal(barLagSessions(YAHOO('2026-11-25'), at('2026-11-27T14:00:00.000Z')), 0, 'after the holiday the Wednesday bar is current')
assert.equal(barLagSessions(YAHOO('2026-11-24'), at('2026-11-27T14:00:00.000Z')), 1)
assert.equal(barLagSessions(YAHOO('2026-11-25'), at('2026-11-30T13:00:00.000Z')), 1, 'Monday morning: Friday 27 Nov is the last session and Thursday was a holiday')
assert.equal(barLagSessions(YAHOO_EDT('2026-07-13'), at('2026-07-14T21:00:00.000Z')), 1, 'EDT bar timestamp maps to its ET day')
assert.equal(barLagSessions(`2026-11-24T00:00:00.000Z`, at('2026-11-25T02:07:49.612Z')), 0, 'Stooq plain-date bars use the calendar day')
assert.equal(barLagSessions(`2026-11-23T00:00:00.000Z`, at('2026-11-25T02:07:49.612Z')), 1)
// a bar stamped 22:00 ET on 24 Nov is already 25 Nov in UTC: it must still count as the 24 Nov session
assert.equal(barLagSessions('2026-11-25T03:00:00.000Z', at('2026-11-26T02:00:00.000Z')), 1, 'bar day is the ET day, not the UTC day')
// guards: a corrupt bar date or an invalid clock must give null, never a long loop or an exception
assert.equal(barLagSessions('0001-01-01T00:00:00.000Z', at('2026-11-25T02:07:49.612Z')), null, 'absurdly old bar date is unknown, not a huge lag')
assert.equal(barLagSessions(YAHOO('2026-11-24'), new Date(NaN)), null, 'an invalid clock does not throw')
assert.equal(barLagSessions(null), null, 'unknown bar date is unknown, not zero')
assert.equal(barLagSessions(undefined), null)
assert.equal(barLagSessions('not a date'), null)

// ---------- stale-bar summary used by both crons (behaviour, not text) ----------
const POSTCLOSE = at('2026-11-25T02:07:49.612Z') // Tue 24 Nov 21:07 ET, session already closed
const items = [
  { symbol: 'AAA', lastBarAt: YAHOO('2026-11-24'), dataSource: 'Yahoo Finance' }, // current
  { symbol: 'BBB', lastBarAt: YAHOO('2026-11-23'), dataSource: 'Yahoo Finance', droppedLatestBarAt: YAHOO('2026-11-24') }, // one behind
  { symbol: 'CCC', lastBarAt: YAHOO('2026-11-20'), dataSource: 'Stooq' }, // two behind (Fri, then Mon+Tue)
  { symbol: 'DDD', lastBarAt: null, dataSource: 'unavailable' }, // no data at all
  { symbol: 'EEE', lastBarAt: 'garbage' }, // unreadable
]
const summary = summarizeStaleBars(items, POSTCLOSE)
assert.equal(summary.checked, 5)
assert.equal(summary.expectedSession, '2026-11-24')
assert.deepEqual(summary.stale, ['BBB:1:Yahoo Finance:dropped@2026-11-24T14:30:00.000Z', 'CCC:2:Stooq'], 'only symbols behind are listed, with data source and the dropped row when there is one')
assert.deepEqual(summary.unknown, ['DDD', 'EEE'], 'a symbol with no usable bar date is reported as unknown, never silently counted as current')
assert.equal(summary.calendarCovered, true)

const clean = summarizeStaleBars([{ symbol: 'AAA', lastBarAt: YAHOO('2026-11-24') }, { symbol: 'BBB', lastBarAt: YAHOO('2026-11-25') }], POSTCLOSE)
assert.deepEqual(clean.stale, [], 'a normal day (current bars, even a newer partial one) produces no warning')
assert.deepEqual(clean.unknown, [])
assert.deepEqual(summarizeStaleBars([], POSTCLOSE).stale, [], 'no symbols means no warning')
assert.equal(summarizeStaleBars([{ symbol: 'AAA', lastBarAt: YAHOO('2026-11-24') }], at('2026-11-25T14:16:53.961Z')).stale.length, 0, 'pre-market run with the Tuesday bar is current')
assert.deepEqual(summarizeStaleBars([{ symbol: 'AAA', lastBarAt: YAHOO('2026-11-23'), dataSource: 'Yahoo Finance' }], at('2026-11-25T14:16:53.961Z')).stale, ['AAA:1:Yahoo Finance'], 'pre-market run still using the Monday bar is flagged')
assert.equal(summarizeStaleBars([{ symbol: 'AAA', lastBarAt: YAHOO('2026-11-24') }], new Date(NaN)).unknown.length, 1, 'an invalid clock reports unknown instead of throwing')

// the holiday calendar ends in 2028: later dates must be flagged so a stale warning is not trusted blindly
assert.equal(CALENDAR_LAST_YEAR, 2028)
assert.equal(summarizeStaleBars([], at('2028-12-29T20:00:00.000Z')).calendarCovered, true, 'last covered year')
assert.equal(summarizeStaleBars([], at('2029-01-02T15:00:00.000Z')).calendarCovered, false, 'the year after the calendar ends is flagged')
assert.equal(summarizeStaleBars([], at('2025-11-28T15:00:00.000Z')).calendarCovered, false, 'before the calendar starts is flagged')

// ---------- dropped latest row (diagnosis of the provider dropping the newest bar) ----------
const D = iso => new Date(iso)
assert.equal(droppedLatestRowAt([{ date: D('2026-11-23T14:30:00.000Z') }, { date: D('2026-11-24T14:30:00.000Z') }], '2026-11-24T14:30:00.000Z'), null, 'newest row was kept: nothing dropped')
assert.equal(droppedLatestRowAt([{ date: D('2026-11-23T14:30:00.000Z') }, { date: D('2026-11-24T14:30:00.000Z') }], '2026-11-23T14:30:00.000Z'), '2026-11-24T14:30:00.000Z', 'newest row newer than the newest kept bar was dropped: report its date')
assert.equal(droppedLatestRowAt([{ date: D('2026-11-24T14:30:00.000Z') }], null), '2026-11-24T14:30:00.000Z', 'every row dropped: the newest one is reported')
assert.equal(droppedLatestRowAt([{ date: D('2026-11-20T14:30:00.000Z') }], '2026-11-23T14:30:00.000Z'), null, 'an older dropped row is not reported (kept bar is newer)')
assert.equal(droppedLatestRowAt([], '2026-11-23T14:30:00.000Z'), null, 'no rows')
assert.equal(droppedLatestRowAt([{ date: null }], '2026-11-23T14:30:00.000Z'), null, 'a row without a date is not reported')
assert.equal(droppedLatestRowAt([{ date: '2026-11-24T14:30:00.000Z' }], '2026-11-23T14:30:00.000Z'), null, 'only real Date values are used (string dates are ignored)')
assert.equal(droppedLatestRowAt([{ date: new Date(NaN) }], null), null, 'an invalid Date does not throw')

// ---------- stored technical snapshot -> freshness item (both crons use it; old rows lack the new fields) ----------
assert.deepEqual(barFreshnessItem('AAA', { lastBarAt: YAHOO('2026-11-23'), dataSource: 'Yahoo Finance', droppedLatestBarAt: YAHOO('2026-11-24') }), { symbol: 'AAA', lastBarAt: YAHOO('2026-11-23'), dataSource: 'Yahoo Finance', droppedLatestBarAt: YAHOO('2026-11-24') })
assert.deepEqual(barFreshnessItem('OLD', { lastBarAt: YAHOO('2026-11-23') }), { symbol: 'OLD', lastBarAt: YAHOO('2026-11-23'), dataSource: null, droppedLatestBarAt: null }, 'an old row without the new fields maps to nulls')
assert.deepEqual(barFreshnessItem('NONE', undefined), { symbol: 'NONE', lastBarAt: undefined, dataSource: null, droppedLatestBarAt: null }, 'a missing technical object does not throw')
assert.deepEqual(summarizeStaleBars([barFreshnessItem('AAA', { lastBarAt: YAHOO('2026-11-23'), dataSource: 'Yahoo Finance', droppedLatestBarAt: YAHOO('2026-11-24') })], at('2026-11-25T14:16:53.961Z')).stale, ['AAA:1:Yahoo Finance:dropped@2026-11-24T14:30:00.000Z'], 'a stored baseline carries its source and dropped row through to the log entry')
assert.deepEqual(summarizeStaleBars([barFreshnessItem('OLD', {})], at('2026-11-25T14:16:53.961Z')).unknown, ['OLD'], 'a baseline row from before this release is reported unknown, not current')

// ---------- wiring (measurement only) ----------
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const indicators = read('lib/indicators.ts')
assert.equal(indicators.split('barLagSessions: lagSessions').length - 1, 2, 'both indicator returns carry the measured lag')
assert.ok(indicators.includes('    lastBarAt,\n    barLagSessions: lagSessions,'), 'the main return still carries lastBarAt next to the lag')
assert.ok(indicators.includes('const lagSessions = barLagSessions(lastBarAt)'), 'the lag is computed from the newest bar date')
assert.ok(indicators.includes('const closes = bars.map(b => b.close)'), 'indicator inputs are still every bar the provider returned (this release does not change values)')
assert.equal(indicators.split('droppedLatestBarAt: droppedLatestAt').length - 1, 2, 'both returns carry the diagnostic dropped-row date')
assert.ok(indicators.includes('droppedLatestAt: droppedLatestRowAt(raw, bars.at(-1)?.date ?? null)') || indicators.includes('const droppedLatestAt = droppedLatestRowAt(raw, bars.at(-1)?.date ?? null)'), 'the dropped-row date comes from the pure helper (kept bars are not changed by it)')
assert.equal(indicators.split("source: 'Yahoo Finance', droppedLatestAt }").length - 1, 2, 'both Yahoo paths pass the dropped-row date through')
assert.ok(indicators.includes("  if (stooq.length > yahoo.length) return { bars: stooq, source: 'Stooq', droppedLatestAt: null }") && indicators.includes("  return { bars: [], source: 'unavailable', droppedLatestAt: null }"), 'Stooq and no-data paths never claim a dropped row')
assert.ok(indicators.includes('const bars = toBars(raw)'), 'the kept bars still come straight from toBars')
assert.ok(indicators.includes('const droppedLatestAt = barsFetch.droppedLatestAt') && indicators.includes('const [barsFetch, weeklyBars] = await Promise.all(['), 'getTechnicalIndicators reads the dropped-row date from the fetch result (v1.41.57: the fetch result may come from the stale-bar policy)')
const daily = read('app/api/cron/daily-analyze/route.ts')
assert.ok(daily.includes('summarizeStaleBars(batchInputs.map(input => barFreshnessItem(input.holding.symbol, input.technical)))') && daily.includes("console.warn('[daily-cron] stale daily bars (sessions behind)', barFreshness)"), 'daily cron logs the shared summary')
assert.ok(daily.includes('barFreshness.stale.length > 0 || barFreshness.unknown.length > 0 || !barFreshness.calendarCovered'), 'daily cron warns on stale, unknown and an expired calendar only')
const premarket = read('app/api/cron/premarket-analyze/route.ts')
assert.ok(premarket.includes('summarizeStaleBars((rawHoldings as any[]).flatMap(') && premarket.includes('baselineBySymbol.get(symbol)') && premarket.includes('barFreshnessItem(symbol, baseline.technical)'), 'pre-market cron checks every holding that has a baseline, not only triggered ones')
assert.ok(premarket.includes("console.warn('[premarket-cron] baseline daily bars behind (sessions)', baselineFreshness)") && premarket.includes('baselineFreshness.stale.length > 0 || baselineFreshness.unknown.length > 0 || !baselineFreshness.calendarCovered'), 'pre-market cron warns on stale, unknown and an expired calendar only')
assert.ok(premarket.includes('holding, technical: baseline.technical, earnings:'), 'pre-market still reuses the baseline indicators (unchanged behaviour)')
const types = read('types/index.ts')
assert.ok(types.includes('barLagSessions?: number | null') && types.includes('lastBarAt?: string | null') && types.includes('droppedLatestBarAt?: string | null'), 'saved technical snapshot may carry the new fields')

console.log('Bar lag regression passed: ET calendar, holidays, early close, daylight saving and stored fields')
