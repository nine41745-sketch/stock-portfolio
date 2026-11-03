import assert from 'node:assert/strict'
import fs from 'node:fs'
import { calcRiskReward, MAX_RISK_REWARD } from '../lib/risk-reward.ts'
import { isPartialUsSessionBar } from '../lib/market-session.ts'
import { toHistorySymbol } from '../lib/provider-symbol.ts'
import { isQuoteUsable } from '../lib/quote-freshness.ts'

// Risk/Reward: stops almost on top of the entry are not meaningful and extreme ratios are capped.
assert.equal(calcRiskReward(100, 95, 110), 2)
assert.equal(calcRiskReward(100, 99.9, 110), null, 'risk below 0.5% of entry must not produce a ratio')
assert.equal(calcRiskReward(521.91, 521.75, 600), null)
assert.equal(calcRiskReward(100, 98, 200), MAX_RISK_REWARD, 'huge ratios are capped')
assert.equal(calcRiskReward(100, 105, 120), null)
assert.equal(calcRiskReward(100, 95, 100), null)
assert.equal(calcRiskReward(null, 95, 110), null)
assert.equal(calcRiskReward(100, Number.NaN, 110), null)

// Symbols: Yahoo/Stooq use dashes for share classes.
assert.equal(toHistorySymbol('BRK.B'), 'BRK-B')
assert.equal(toHistorySymbol(' bf.b '), 'BF-B')
assert.equal(toHistorySymbol('AAPL'), 'AAPL')
assert.equal(toHistorySymbol('BRK-B'), 'BRK-B')

// Partial session: Monday 2026-11-02 at 11:00 ET (EST, UTC-5) = 16:00Z, session bar opens 14:30Z.
const monday1100 = new Date('2026-11-02T16:00:00Z')
assert.equal(isPartialUsSessionBar('2026-11-02T14:30:00.000Z', monday1100), true)
assert.equal(isPartialUsSessionBar('2026-10-30T13:30:00.000Z', monday1100), false, 'Friday bar is complete on Monday')
assert.equal(isPartialUsSessionBar('2026-11-02T14:30:00.000Z', new Date('2026-11-02T22:00:00Z')), false, 'after close at 17:00 ET')
assert.equal(isPartialUsSessionBar('2026-11-02T14:30:00.000Z', new Date('2026-11-02T13:00:00Z')), false, 'before open at 08:00 ET')
assert.equal(isPartialUsSessionBar('2026-11-01T14:30:00.000Z', new Date('2026-11-01T16:00:00Z')), false, 'Sunday')
assert.equal(isPartialUsSessionBar('2026-11-02T00:00:00.000Z', monday1100), true, 'Stooq date-only bar')
assert.equal(isPartialUsSessionBar(null, monday1100), false)
assert.equal(isPartialUsSessionBar('not-a-date', monday1100), false)

// Quote freshness: a quote older than the newest historical bar must be rejected.
const now = Date.parse('2026-11-02T16:00:00Z')
const bar = '2026-11-02T14:30:00.000Z'
assert.equal(isQuoteUsable({ c: 513.6, t: Math.floor(now / 1000) - 30 }, bar, now), true)
assert.equal(isQuoteUsable({ c: 521.91, t: Math.floor(Date.parse('2026-10-30T20:00:00Z') / 1000) }, bar, now), false, 'Friday close quote vs Monday bar')
assert.equal(isQuoteUsable({ c: 0, t: 1 }, bar, now), false)
assert.equal(isQuoteUsable(null, bar, now), false)
assert.equal(isQuoteUsable({ c: 10 }, bar, now), true, 'missing timestamp keeps a positive price')
assert.equal(isQuoteUsable({ c: 10, t: Math.floor(now / 1000) + 5 * 86400 }, bar, now), false, 'future timestamp')

// Source wiring: buy-decision path must bypass the SWR quote cache; scanner uses shared R:R helper.
const finnhub = fs.readFileSync(new URL('../lib/finnhub.ts', import.meta.url), 'utf8')
assert.match(finnhub, /fresh\?: boolean/)
assert.match(finnhub, /cache: 'no-store'/)
const stockCheckData = fs.readFileSync(new URL('../lib/stock-check-data.ts', import.meta.url), 'utf8')
assert.match(stockCheckData, /getQuote\(symbol, undefined, \{ fresh: true \}\)/)
assert.match(stockCheckData, /isQuoteUsable\(rawQuote, technical\.lastBarAt\)/)
const scanner = fs.readFileSync(new URL('../app/api/scanner/route.ts', import.meta.url), 'utf8')
assert.match(scanner, /calcRiskReward\(price, support, resistance\)/)
const indicators = fs.readFileSync(new URL('../lib/indicators.ts', import.meta.url), 'utf8')
assert.match(indicators, /isPartialUsSessionBar\(allBars\.at\(-1\)\?\.date/)
assert.match(indicators, /toHistorySymbol\(rawSymbol\)/)

console.log('scan data quality tests passed')

const aiSource = fs.readFileSync(new URL('../lib/stock-check-ai.ts', import.meta.url), 'utf8')
assert.match(aiSource, /export function buildStockCheckFacts/)
assert.match(aiSource, /ข้อเท็จจริงที่คำนวณแล้ว/)
assert.match(aiSource, /ห้ามแนะนำให้ซื้อ ขาย หรือถือสถานะที่มีอยู่/)
console.log('stock check AI prompt guard tests passed')

// Contradictory signals: a broken structural support must not be labelled "Near Support".
const { scoreScannerCandidate } = await import('../lib/stock-scanner.ts')
const nearSupportInput = {
  trend: 'SIDEWAYS', rsi14: 50, weeklyRsi14: 50, macdHistogram: -0.1, lastClose: 101, ema50: 110,
  support: 100, resistance: 120, volumeRatio: 1, week52High: 150, week52Low: 80,
  relativeStrength20: 0, relativeStrength60: 0, earningsDays: null, earningsStatus: 'none',
}
const intact = scoreScannerCandidate({ ...nearSupportInput, importantSupport: 95 })
const broken = scoreScannerCandidate({ ...nearSupportInput, importantSupport: 105 })
assert.equal(intact.setup, 'NEAR_SUPPORT')
assert.equal(broken.setup, 'WAIT', 'broken important support downgrades Near Support to Wait')
assert.ok(broken.categoryScores.priceLocation < intact.categoryScores.priceLocation)
assert.equal(scoreScannerCandidate(nearSupportInput).setup, 'NEAR_SUPPORT', 'missing important support keeps previous behaviour')

// Discovery must use the same earnings status as Scanner ("none" is not "unknown").
const discovery = fs.readFileSync(new URL('../app/api/discovery/route.ts', import.meta.url), 'utf8')
assert.match(discovery, /getUpcomingEarningsStatus\(symbol, providers\)/)
assert.doesNotMatch(discovery, /earningsDays === null \? 'unknown' : 'found'/)
assert.match(discovery, /importantSupport: t\.importantSupport/)
assert.match(scanner, /importantSupport: technical\.importantSupport/)
assert.match(stockCheckData, /importantSupport: technical\.importantSupport/)
console.log('signal consistency tests passed')

const stockCheckPlanSource = fs.readFileSync(new URL('../lib/stock-check.ts', import.meta.url), 'utf8')
assert.match(stockCheckPlanSource, /if \(decision === 'AVOID'\) \{\s*const rrIndex = reasons\.findIndex\(reason => reason\.startsWith\('R:R '\)\)/)
console.log('stock check AVOID/R:R consistency tests passed')
