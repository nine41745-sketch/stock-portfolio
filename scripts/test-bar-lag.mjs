import assert from 'node:assert/strict'
import fs from 'node:fs'
import { barLagSessions, lastCompletedSessionDate, tradingSessionsAfter } from '../lib/market-status.ts'

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
assert.equal(barLagSessions(null), null, 'unknown bar date is unknown, not zero')
assert.equal(barLagSessions(undefined), null)
assert.equal(barLagSessions('not a date'), null)

// ---------- wiring (measurement only) ----------
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const indicators = read('lib/indicators.ts')
assert.equal(indicators.split('barLagSessions: lagSessions').length - 1, 2, 'both indicator returns carry the measured lag')
assert.ok(indicators.includes('const lagSessions = barLagSessions(lastBarAt)'), 'the lag is computed from the newest bar date')
assert.ok(indicators.includes('const closes = bars.map(b => b.close)'), 'indicator inputs are still every bar the provider returned (this release does not change values)')
const daily = read('app/api/cron/daily-analyze/route.ts')
assert.ok(daily.includes("'[daily-cron] stale daily bars (sessions behind)'") && daily.includes('lastCompletedSessionDate()'), 'daily cron logs stale bars')
const premarket = read('app/api/cron/premarket-analyze/route.ts')
assert.ok(premarket.includes("'[premarket-cron] baseline daily bars behind (sessions)'"), 'pre-market cron logs a stale baseline')
assert.ok(premarket.includes('holding, technical: baseline.technical, earnings:'), 'pre-market still reuses the baseline indicators (unchanged behaviour)')
const types = read('types/index.ts')
assert.ok(types.includes('barLagSessions?: number | null') && types.includes('lastBarAt?: string | null'), 'saved technical snapshot may carry the new fields')

console.log('Bar lag regression passed: ET calendar, holidays, early close, daylight saving and stored fields')
