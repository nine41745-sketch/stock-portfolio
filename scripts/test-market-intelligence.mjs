import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTrend, latestInsights, summarizeBenchmarks } from '../lib/market-intelligence.ts'

const date = '2026-10-11'
const item = (date, symbol, news, summary = 'Previously recorded') => ({
  symbol, analysis_date: date, result: { usedNews: news, summary },
})
const news = (headline, impact) => ({ headline, impact })

test('deduplicates across analysis dates', () => {
  const x = buildTrend([item('2026-10-08', 'NVDA', [news('Same', 'POSITIVE')]),
    item('2026-10-10', 'NVDA', [news('same', 'POSITIVE')])], ['NVDA'], date)
  assert.equal(x.month.positive, 1)
  assert.equal(x.uniqueHeadlines, 1)
  assert.equal(x.days.length, 1)
})
test('LOW is not NEUTRAL', () => {
  const x = buildTrend([item(date, 'NVDA', [news('foo', 'LOW')])], ['NVDA'], date)
  assert.equal(x.month.score, null)
  assert.equal(x.month.neutral, 0)
  assert.equal(x.month.unknown, 1)
})
test('scope only symbols from active portfolio', () => {
  const x = buildTrend([item(date, 'NVDA', [news('Positive', 'POSITIVE')]),
    item(date, 'AAPL', [news('Negative', 'NEGATIVE')])], ['NVDA'], date)
  assert.equal(x.month.score, 100)
})
test('7 and 30-day totals differ', () => {
  const x = buildTrend([item('2026-09-22', 'NVDA', [news('Old', 'NEGATIVE')]),
    item('2026-10-10', 'NVDA', [news('New', 'POSITIVE')])], ['NVDA'], date)
  assert.equal(x.week.score, 100)
  assert.equal(x.month.score, 0)
})
test('first chronological observation wins duplicate date', () => {
  const x = buildTrend([item(date, 'NVDA', [news('Duplicate', 'POSITIVE')]),
    item('2026-09-23', 'NVDA', [news('duplicate', 'POSITIVE')])], ['NVDA'], date)
  assert.equal(x.week.sample, 0)
})
test('future and too-old evidence excluded', () => {
  const x = buildTrend([item('2026-10-12', 'NVDA', [news('Future', 'POSITIVE')]),
    item('2026-09-10', 'NVDA', [news('Old', 'NEGATIVE')])], ['NVDA'], date)
  assert.equal(x.month.sample, 0)
})
test('malformed date rejected', () => {
  assert.throws(() => buildTrend([], [], '2026/10/11'))
})
test('malformed historical JSON cannot create sentiment', () => {
  const x = buildTrend([{ symbol: 'NVDA', analysis_date: date, result: null },
    item(date, 'NVDA', [null, { headline: 'hi', impact: 'WRONG' }])], ['NVDA'], date)
  assert.equal(x.month.sample, 0)
  assert.equal(x.month.unknown, 1)
})
test('conflicting classification does not count bullish', () => {
  const x = buildTrend([item('2026-10-10', 'NVDA', [news('same', 'POSITIVE')]),
    item(date, 'NVDA', [news('same', 'NEGATIVE')])], ['NVDA'], date)
  assert.equal(x.month.sample, 0)
})
test('latest insights are restricted by active symbols', () => {
  const x = latestInsights([item('2026-10-09', 'NVDA', [], 'old'),
    item(date, 'NVDA', [], 'new'), item(date, 'AAPL', [], 'private')], ['NVDA'])
  assert.deepEqual(x.map(y => y.summary), ['new'])
})
test('no invented benchmarks when provider fails', () => {
  const lines = summarizeBenchmarks([{symbol: 'SPY', price: null, changePct: null, quotedAt: null}])
  assert.match(lines[0], /ไม่มีราคา/)
})
