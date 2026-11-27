import assert from 'node:assert/strict'
import fs from 'node:fs'
import { hoursSinceLastSessionClose, isPostCloseRunWindow, lastCompletedSessionDate, POST_CLOSE_RUN_MAX_HOURS } from '../lib/market-status.ts'

// v1.41.57: the post-close cron now runs at 05:15 UTC Tue-Sat (after midnight ET) because the daily bar of the session was found missing at
// 21:07 ET and present by 23:35 ET. The old gate ("today in ET is a trading day") would skip every Friday session (Saturday in ET), so the gate
// is "a US session closed within the last N hours". Everything here is checked with fixed dates; no cron run is needed.

const at = iso => new Date(iso)
const run = iso => isPostCloseRunWindow(at(iso))
const hours = iso => hoursSinceLastSessionClose(at(iso))
const near = (value, expected, message) => assert.ok(Math.abs(value - expected) < 0.05, `${message} (got ${value}, expected ${expected})`)

assert.equal(POST_CLOSE_RUN_MAX_HOURS, 18, 'covers EST/EDT and the 13:00 early close with the Hobby cron delay (~1 h)')

// ---------- the new schedule: 05:15 UTC (+ up to ~1 h Hobby delay), Tue-Sat ----------
assert.equal(lastCompletedSessionDate(at('2026-11-24T05:07:00Z')), '2026-11-23')
assert.equal(run('2026-11-24T05:07:00Z'), true, 'Tuesday 00:07 ET analyses Monday')
near(hours('2026-11-24T05:07:00Z'), 8.12, 'Monday close 16:00 ET to 00:07 ET')
assert.equal(run('2026-11-25T06:07:00Z'), true, 'Wednesday run delayed by an hour analyses Tuesday')
assert.equal(lastCompletedSessionDate(at('2026-11-26T05:07:00Z')), '2026-11-25')
assert.equal(run('2026-11-26T05:07:00Z'), true, 'Thanksgiving morning analyses Wednesday (the holiday is that same day, not before)')
assert.equal(run('2026-12-01T05:07:00Z'), true, 'Tuesday after a weekend analyses Monday')
near(hours('2026-12-01T05:07:00Z'), 8.12, 'EST')
near(hours('2026-07-07T05:07:00Z'), 9.12, 'EDT (one hour later in ET)')
assert.equal(run('2026-07-07T05:07:00Z'), true, 'daylight saving: Tuesday 05:07Z analyses Monday 6 Jul')
assert.equal(run('2026-03-10T05:07:00Z'), true, 'the day after daylight saving began (8 Mar) still resolves the right session')
assert.equal(run('2026-11-03T05:07:00Z'), true, 'two days after daylight saving ended (1 Nov)')

// ---------- the Friday session is run on Saturday: ET date is already Saturday after midnight, which the old gate skipped ----------
assert.equal(lastCompletedSessionDate(at('2026-12-05T05:07:00Z')), '2026-12-04')
assert.equal(run('2026-12-05T05:07:00Z'), true, 'Saturday 00:07 ET analyses Friday')
assert.equal(run('2026-12-05T06:07:00Z'), true, 'Saturday 01:07 ET (delayed run) analyses Friday')
assert.equal(run('2026-07-18T06:07:00Z'), true, 'Saturday in summer analyses Friday')
near(hours('2026-11-28T06:07:00Z'), 12.12, 'Friday 27 Nov closed early at 13:00 ET: the Saturday run is 12 h later')
assert.equal(run('2026-11-28T06:07:00Z'), true, 'Saturday after the early close analyses Friday 27 Nov')

// ---------- a holiday Friday still analyses Thursday's session; the Saturday after it does not repeat ----------
assert.equal(run('2026-12-25T05:07:00Z'), true, 'Christmas morning analyses Thursday 24 Dec (early close)')
assert.equal(run('2026-12-26T05:07:00Z'), false, 'Saturday after Christmas: nothing new closed (Friday was a holiday)')

// ---------- holidays and weekends without a new session are skipped ----------
assert.equal(run('2026-11-27T05:07:00Z'), false, 'Friday after Thanksgiving: last session is Wednesday, closed ~32 h ago')
assert.ok(hours('2026-11-27T05:07:00Z') > POST_CLOSE_RUN_MAX_HOURS)
assert.equal(run('2026-11-29T06:07:00Z'), false, 'Sunday')
assert.equal(run('2026-12-06T06:07:00Z'), false, 'Sunday')
assert.equal(run('2026-07-04T06:07:00Z'), false, 'Saturday 4 Jul 2026 (Friday 3 Jul was the observed holiday)')
assert.equal(run('2027-01-02T05:07:00Z'), false, 'Saturday after the New Year holiday Friday')

// ---------- boundary and bad input ----------
// just after the close (provider buffer of 20 minutes not over): the session that just closed is not "last completed" yet, so the previous one counts
assert.equal(lastCompletedSessionDate(at('2026-12-04T21:10:00Z')), '2026-12-03')
assert.equal(lastCompletedSessionDate(at('2026-12-04T21:20:00Z')), '2026-12-04')
assert.equal(hoursSinceLastSessionClose(new Date(NaN)), null, 'an invalid clock does not throw')
assert.equal(isPostCloseRunWindow(new Date(NaN)), false)
assert.equal(isPostCloseRunWindow(at('2026-11-24T05:07:00Z'), 8), false, 'the limit argument is honoured (8.12 h > 8)')
assert.equal(isPostCloseRunWindow(at('2026-11-24T05:07:00Z'), 9), true)

// ---------- wiring ----------
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'))
assert.ok(vercel.crons.some(c => c.path === '/api/cron/daily-analyze' && c.schedule === '15 5 * * 2-6'), 'post-close cron is 05:15 UTC Tue-Sat')
assert.ok(vercel.crons.some(c => c.path === '/api/cron/premarket-analyze' && c.schedule === '45 12 * * 1-5') && vercel.crons.some(c => c.path === '/api/cron/premarket-analyze' && c.schedule === '45 13 * * 1-5'), 'pre-market schedule unchanged')
assert.equal(vercel.git.deploymentEnabled.main, false, 'automatic main deployments stay off')
const daily = read('app/api/cron/daily-analyze/route.ts')
assert.ok(daily.includes('if (!isPostCloseRunWindow(runNow)) {') && daily.includes('const runNow = new Date()'), 'the post-close cron decides from the last closed session')
assert.ok(!daily.includes('getUsMarketClock') && !daily.includes('marketClock.isTradingDay'), 'the post-close cron no longer depends on the current ET date being a trading day')
assert.ok(daily.includes("skipped: true,") && daily.includes("reason: 'No US session closed recently (market holiday or weekend)',") && daily.includes('lastSession: lastCompletedSessionDate(runNow)') && daily.includes('hoursSinceClose: hoursSinceLastSessionClose(runNow)'), 'a skipped run explains itself')
assert.ok(read('app/api/cron/premarket-analyze/route.ts').includes('getUsMarketClock'), 'the pre-market cron keeps its own ET trading-day gate')

console.log('Post-close window regression passed: Friday-session runs, holidays, early close, daylight saving and the new schedule')
