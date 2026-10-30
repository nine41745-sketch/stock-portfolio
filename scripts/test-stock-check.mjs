import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

async function importTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
      strict: true,
    },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${filePath} transpile diagnostics: ${errors.map(e => e.messageText).join('; ')}`)
  const encoded = Buffer.from(compiled.outputText).toString('base64')
  return import(`data:text/javascript;base64,${encoded}`)
}

const stockCheck = await importTsModule('lib/stock-check.ts')
const stockScanner = await importTsModule('lib/stock-scanner.ts')
const stockCheckPresentation = await importTsModule('lib/stock-check-presentation.ts')
const todayCandidates = await importTsModule('lib/today-candidates.ts')
const earningsStatus = await importTsModule('lib/earnings-status.ts')
assert.equal(stockScanner.MAX_SCAN_SYMBOLS, 12, 'Scanner requests must be capped at 12 unique symbols')
const allScannerSymbols = stockScanner.dedupeScannerSymbols(Object.values(stockScanner.SCANNER_UNIVERSES))
assert.equal(allScannerSymbols.length, 29, 'All scanner groups should still expose 29 unique symbols')
const scannerBatches = stockScanner.chunkScannerSymbols(allScannerSymbols)
assert.deepEqual(scannerBatches.map(batch => batch.length), [8, 8, 8, 5], 'Today Opportunity must split 29 unique symbols into batches of at most 8')
assert.deepEqual(scannerBatches.flat(), allScannerSymbols, 'Batching must retain each unique scanner ticker in stable order')
assert.ok(scannerBatches.every(batch => batch.length <= 8), 'No Today Opportunity client batch may exceed 8 symbols')
assert.equal(stockScanner.MAX_SCAN_SYMBOLS, 12, 'The server route request cap must remain 12')
const scoreInput = {
  trend: 'UPTREND', rsi14: 55, weeklyRsi14: 57, macdHistogram: 0.4,
  lastClose: 100, ema50: 98, support: 95, resistance: 110, volumeRatio: 1.2,
  week52High: 120, week52Low: 70, relativeStrength20: 3, relativeStrength60: 5,
}

assert.equal(stockScanner.EARNINGS_UNKNOWN_SCORE_PENALTY, 8, 'Unknown earnings penalty must be a named, explicit constant')
const scoreWithEarnings = stockScanner.scoreScannerCandidate({ ...scoreInput, earningsStatus: 'found', earningsDays: 30 })
const scoreWithoutEarnings = stockScanner.scoreScannerCandidate({ ...scoreInput, earningsStatus: 'none', earningsDays: null })
const scoreUnknownEarnings = stockScanner.scoreScannerCandidate({ ...scoreInput, earningsStatus: 'unknown', earningsDays: null })
assert.equal(scoreWithEarnings.score, scoreWithoutEarnings.score, 'A confirmed empty calendar and a distant known event should not incur the unknown-data penalty')
assert.equal(scoreUnknownEarnings.score, Math.max(0, Object.values(scoreUnknownEarnings.categoryScores).reduce((sum, value) => sum + value, 0) - stockScanner.EARNINGS_UNKNOWN_SCORE_PENALTY), 'Unknown earnings must reduce the six-category total by the named penalty')
assert.match(scoreUnknownEarnings.reasons.join(' '), /วันประกาศงบยังไม่ทราบ/, 'Unknown earnings must be disclosed in score reasons')

const missingCategoryScore = stockScanner.scoreScannerCandidate({
  ...scoreInput, trend: 'UNKNOWN', rsi14: null, weeklyRsi14: null, macdHistogram: null,
  volumeRatio: null, support: null, resistance: null, week52High: null, week52Low: null,
  relativeStrength20: null, relativeStrength60: null, ema50: null, earningsStatus: 'unknown', earningsDays: null,
})
assert.deepEqual(missingCategoryScore.categoryScores, {
  trend: 0, momentum: 0, volume: 0, priceLocation: 0, relativeStrength: 0, riskCatalyst: 0,
}, 'A score category with missing required inputs must contribute zero rather than a baseline')

const earningsNone = earningsStatus.resolveUpcomingEarningsStatus({ ok: true, earningsCalendar: [] }, new Date('2026-10-01T00:00:00.000Z'))
const earningsFound = earningsStatus.resolveUpcomingEarningsStatus({ ok: true, earningsCalendar: [{ date: '2026-10-12', hour: 'bmo' }] }, new Date('2026-10-01T00:00:00.000Z'))
const earningsUnknown = earningsStatus.resolveUpcomingEarningsStatus({ ok: false, earningsCalendar: [] }, new Date('2026-10-01T00:00:00.000Z'))
assert.equal(earningsNone.status, 'none', 'A successful empty earnings calendar must mean none')
assert.deepEqual(earningsFound, { status: 'found', earnings: { date: '2026-10-12', daysUntil: 11, hour: 'bmo' } })
assert.equal(earningsUnknown.status, 'unknown', 'A failed provider response must remain unknown, not none')

const duplicateSymbols = stockScanner.dedupeScannerSymbols([['NVDA', 'MSFT', 'AAA'], ['NVDA', 'AVGO'], ['MSFT', 'JPM']])
assert.deepEqual(duplicateSymbols, ['NVDA', 'MSFT', 'AAA', 'AVGO', 'JPM'], 'Scanner symbols must be deduplicated before provider calls while retaining stable order')

for (const fixture of [
  { symbol: 'COST', rr: 0.9 },
  { symbol: 'V', rr: 0.96 },
  { symbol: 'JPM', rr: 0.17 },
]) {
  const decision = stockCheck.normalizeDecisionForRiskReward('BUY_ON_PULLBACK', fixture.rr)
  assert.equal(decision, 'SKIP_POOR_RR', `${fixture.symbol} with screenshot R:R @ Entry must be skipped`)
  assert.equal(todayCandidates.isTodayOpportunityEligible(decision, fixture.rr), false, `${fixture.symbol} must not remain in opportunity results`)
  assert.equal(todayCandidates.opportunityLabel({ decision, buyMode: null, price: 100, entryZone: { low: 90, high: 95 }, rrAtEntry: fixture.rr }), 'ข้าม · ไม่คุ้มเสี่ยง')
}
for (const fixture of [
  { symbol: 'MSFT', rr: 3.25 },
  { symbol: 'CRWD', rr: 1.51 },
]) {
  const decision = stockCheck.normalizeDecisionForRiskReward('BUY_ON_PULLBACK', fixture.rr)
  assert.equal(decision, 'BUY_ON_PULLBACK', `${fixture.symbol} must keep the pullback decision at or above 1.5`)
  assert.equal(todayCandidates.isTodayOpportunityEligible(decision, fixture.rr), true)
  assert.match(todayCandidates.opportunityLabel({ decision, buyMode: null, price: 100, entryZone: { low: 90, high: 95 }, rrAtEntry: fixture.rr }), /รอย่อ · ราคาต้องลดลง 5\.00% ถึงขอบบนช่วงราคาเข้าซื้อ/)
}
assert.equal(stockCheck.BREAKOUT_MAX_DISTANCE_PCT, 3, 'Breakout waiting distance must be a named 3% constant')
const breakoutDistancePlan = resistance => stockCheck.buildStockCheck({
  trend: 'DOWNTREND', setup: 'WAIT', score: 60,
  price: 100, ema50: 90, ema200: 110, atr14: 2,
  support: 80, resistance, rsi14: 50, weeklyRsi14: 52,
  macdHistogram: 0.2, volumeRatio: 1, relativeStrength20: 1,
  relativeStrength60: 2, week52High: 160, week52Low: 70,
  earningsDays: 20, pe: 20,
})
for (const fixture of [
  { distancePct: 0.9, resistance: 100.9 },
  { distancePct: 3, resistance: 103 },
]) {
  assert.equal(breakoutDistancePlan(fixture.resistance).decision, 'WAIT_FOR_BREAKOUT', `${fixture.distancePct}% resistance distance should remain a breakout wait`)
}
for (const fixture of [
  { name: '3.1%', resistance: 103.1, expectedDistance: '3.1%' },
  { name: 'ARM-like 39%', resistance: 139, expectedDistance: '39.0%' },
]) {
  const plan = breakoutDistancePlan(fixture.resistance)
  assert.equal(plan.decision, 'WATCH', `${fixture.name} resistance distance should be watch-only`)
  assert.match(plan.summary, new RegExp(`ห่างแนวต้าน ${fixture.expectedDistance}`), `${fixture.name} watch summary must explain the resistance distance`)
}
assert.equal(todayCandidates.trendLabel('UPTREND'), 'แนวโน้มขาขึ้น')
assert.equal(todayCandidates.setupLabel('BREAKOUT'), 'ราคาทะลุแนวต้าน')
assert.equal(todayCandidates.shouldShowEarningsUnknownBanner([]), false, 'No validated stocks must not show an earnings warning banner')
assert.equal(todayCandidates.shouldShowEarningsUnknownBanner([{ earningsStatus: 'unknown' }, { earningsStatus: 'found' }]), true, 'Exactly half unknown must show the earnings warning banner')
assert.equal(todayCandidates.shouldShowEarningsUnknownBanner([{ earningsStatus: 'unknown' }, { earningsStatus: 'none' }, { earningsStatus: 'found' }]), false, 'Less than half unknown must not show the earnings warning banner')
assert.equal(todayCandidates.shouldShowEarningsUnknownBanner([{ earningsStatus: 'unknown' }, { earningsStatus: 'unknown' }, { earningsStatus: 'none' }, { earningsStatus: 'found' }]), true, 'At least half unknown must show the earnings warning banner')
assert.equal(stockCheckPresentation.providerQuoteTimestamp(1793289600), '2026-10-29T16:00:00.000Z', 'Provider epoch seconds should be preserved as an ISO timestamp')
assert.equal(stockCheckPresentation.providerQuoteTimestamp(null), null, 'Missing provider timestamp must remain unavailable')
assert.equal(stockCheckPresentation.providerQuoteTimestamp(Number.NaN), null, 'Invalid provider timestamp must fail closed')

const malformedAi = stockCheckPresentation.parseStockCheckAiResponse(
  '{"summary": "synthetic unfinished JSON',
  'สรุปจาก Stock Check แบบสังเคราะห์',
)
assert.equal(malformedAi.summary, 'สรุปจาก Stock Check แบบสังเคราะห์', 'Malformed model output must fall back to deterministic summary, not show raw JSON')
assert.deepEqual(malformedAi.reasons, [], 'Malformed model output must not create synthetic reasons')

const validAi = stockCheckPresentation.parseStockCheckAiResponse(
  '{"summary":"สรุปสังเคราะห์","reasons":["เหตุผลสังเคราะห์"],"risks":["ความเสี่ยงสังเคราะห์"],"action":"การกระทำตามแผนเดิม"}',
  'fallback',
)
assert.equal(validAi.summary, 'สรุปสังเคราะห์', 'Valid structured model response should preserve its summary')
assert.deepEqual(validAi.reasons, ['เหตุผลสังเคราะห์'], 'Valid structured model response should preserve reason strings')
const matchingAiSummary = stockCheckPresentation.parseStockCheckAiResponse(
  '{"summary":"same text","reasons":[],"risks":[],"action":"same text"}',
  'same text',
)
assert.equal(matchingAiSummary.usedFallbackSummary, false, 'A valid AI summary equal to the deterministic summary must not be mislabeled as fallback')

const freshQuoteText = stockCheckPresentation.formatStockCheckFreshness({
  checkedAt: '2026-10-29T16:02:00.000Z',
  priceSource: 'finnhub',
  quoteTimestamp: '2026-10-29T16:00:00.000Z',
})
assert.match(freshQuoteText, /2026-10-29 23:00:00 ICT/, 'Provider quote time must be shown in Asia/Bangkok')
assert.match(freshQuoteText, /อายุ 2 นาที/, 'Quote age must be measured against checkedAt, not the machine clock')

const missingQuoteTimeText = stockCheckPresentation.formatStockCheckFreshness({
  checkedAt: '2026-10-29T16:02:00.000Z',
  priceSource: 'finnhub',
  quoteTimestamp: null,
})
assert.match(missingQuoteTimeText, /ไม่ได้รับเวลาราคาจากผู้ให้บริการ/, 'Missing provider timestamp must be explicit')
assert.match(missingQuoteTimeText, /2026-10-29 23:02:00 ICT/, 'Request/check time may be displayed only as a separately labeled time')

const historicalPriceText = stockCheckPresentation.formatStockCheckFreshness({
  checkedAt: '2026-10-29T16:02:00.000Z',
  priceSource: 'historical',
  quoteTimestamp: null,
})
assert.match(historicalPriceText, /ข้อมูลย้อนหลัง/, 'Historical fallback must be identified as historical')
assert.match(historicalPriceText, /ไม่ใช่ราคาเรียลไทม์/, 'Historical fallback must not imply live pricing')

assert.match(stockCheckPresentation.formatTarget2Context('historical-52w-high'), /จุดสูงสุดย้อนหลัง 52 สัปดาห์/)
assert.match(stockCheckPresentation.formatTarget2Context('historical-52w-high'), /ไม่ใช่ราคาเป้าหมายคาดการณ์/)
assert.match(stockCheckPresentation.formatTarget2Context('plan-extension'), /ระดับอ้างอิงจากแผน/)

const buyNow = stockCheck.buildStockCheck({
  trend: 'UPTREND', setup: 'NEAR_SUPPORT', score: 82,
  price: 100.5, ema50: 99.5, ema200: 90, atr14: 2,
  support: 100, resistance: 115, rsi14: 55, weeklyRsi14: 58,
  macdHistogram: 1, volumeRatio: 1.3, relativeStrength20: 5,
  relativeStrength60: 12, week52High: 120, week52Low: 70,
  earningsDays: 20, pe: 25,
})
assert.equal(buyNow.decision, 'BUY_NOW', 'Strong near-support setup should permit BUY_NOW')
assert.equal(buyNow.buyMode, 'STANDARD', 'Classic in-zone BUY_NOW must remain the standard buy mode')
assert.ok((buyNow.riskRewardAtEntry ?? 0) >= 1.5, 'Standard BUY_NOW plan must have acceptable R:R')
assert.ok((buyNow.stopLoss ?? 999) < (buyNow.entryZone?.low ?? 0), 'Stop must stay below planned entry')
assert.equal(buyNow.target2Basis, 'historical-52w-high', 'Target 2 should identify the historical high when that value supplies the final level')
const buyNowPlannedEntry = (buyNow.entryZone.low + buyNow.entryZone.high) / 2
const buyNowRisk = buyNowPlannedEntry - buyNow.stopLoss
assert.equal(buyNow.target1, 115, 'Target 1 should use the eligible structural resistance without a stop-risk floor')
assert.ok(buyNow.stopLoss < buyNow.entryZone.low, 'Stop must remain below the entire Entry Zone')
assert.equal(buyNow.riskRewardAtEntry, Number(((buyNow.target1 - buyNowPlannedEntry) / buyNowRisk).toFixed(2)), 'Entry R:R must use the exact planned entry, stop and Target 1 displayed')
assert.equal(buyNow.riskRewardNow, Number(((buyNow.target1 - 100.5) / (100.5 - buyNow.stopLoss)).toFixed(2)), 'Current-price R:R must use the same stop and Target 1')

const stopPlan = overrides => stockCheck.buildStockCheck({
  trend: 'UPTREND', setup: 'BREAKOUT', score: 80,
  price: 400, ema50: null, ema200: null, atr14: 4,
  support: null, resistance: 100, rsi14: 55, weeklyRsi14: 58,
  macdHistogram: 1, volumeRatio: 1.2, relativeStrength20: 3,
  relativeStrength60: 5, week52High: 500, week52Low: 70,
  earningsDays: null, pe: null, ...overrides,
})
const closestStop = stopPlan({ swingLow: 97 })
assert.deepEqual(closestStop.entryZone, { low: 100, high: 104 })
assert.equal(closestStop.stopLoss, 94, 'Stop must preserve max(1 ATR, 2% of price) planned-entry risk')
assert.ok(closestStop.stopLoss < closestStop.entryZone.low)
assert.ok(102 - closestStop.stopLoss >= Math.max(4 * stockCheck.ATR_STOP_MIN_MULT, 400 * stockCheck.MIN_RISK_PCT), 'Stop must never be closer than the configured minimum risk')
assert.equal(closestStop.riskRewardAtEntry, Number(((closestStop.target1 - 102) / (102 - closestStop.stopLoss)).toFixed(2)), 'Entry R:R must use the selected stop')
assert.equal(closestStop.riskRewardNow, Number(((closestStop.target1 - 400) / (400 - closestStop.stopLoss)).toFixed(2)), 'NOW R:R must use the same selected stop')
const targetWithWiderStop = stopPlan({ swingLow: 90 })
assert.equal(targetWithWiderStop.target1, closestStop.target1, 'Target 1 must not change when only Stop risk changes')

const cappedStop = stopPlan({ swingLow: 102 })
assert.equal(cappedStop.stopLoss, 94, 'The minimum-risk floor must take precedence when it is below the Entry Zone cap')
assert.ok(cappedStop.stopLoss < cappedStop.entryZone.low)

const noSwingLowStop = stopPlan({ swingLow: null })
assert.equal(noSwingLowStop.stopLoss, 94, 'Missing swing low should fall back while preserving minimum risk')
assert.ok(noSwingLowStop.stopLoss < noSwingLowStop.entryZone.low)

const strictEntryCap = stockCheck.buildStockCheck({
  trend: 'UPTREND', setup: 'BREAKOUT', score: 80,
  price: 120, ema50: null, ema200: null, atr14: 1,
  support: null, resistance: 100, rsi14: 55, weeklyRsi14: 58,
  macdHistogram: 1, volumeRatio: 1.2, relativeStrength20: 3,
  relativeStrength60: 5, week52High: 500, week52Low: 70,
  earningsDays: null, pe: null, swingLow: 110,
})
const strictEntryCapPlannedEntry = (strictEntryCap.entryZone.low + strictEntryCap.entryZone.high) / 2
assert.equal(strictEntryCap.stopLoss, Number((strictEntryCapPlannedEntry - Math.max(1 * stockCheck.ATR_STOP_MIN_MULT, 120 * stockCheck.MIN_RISK_PCT)).toFixed(2)), 'Stop must preserve minRisk when swing and ATR candidates sit above the Entry Zone cap')
assert.ok(strictEntryCap.stopLoss <= strictEntryCap.entryZone.low - 0.01, 'Stop must remain at least one cent below Entry Zone')
assert.ok(Number((strictEntryCapPlannedEntry - strictEntryCap.stopLoss).toFixed(2)) >= Math.max(1 * stockCheck.ATR_STOP_MIN_MULT, 120 * stockCheck.MIN_RISK_PCT), 'Stop must never be closer than minRisk')
assert.equal(stockCheck.calculateStockCheckStopLoss({
  swingLowStop: 105, atrStop: 106, entryLow: 100, plannedEntry: 102, minRisk: 1,
}), 99.99, 'When swing and ATR stops exceed the cap and minRisk permits it, Stop must cap at entryLow - 0.01')

const poorRrPullback = stockCheck.buildStockCheck({
  trend: 'UPTREND', setup: 'NEAR_SUPPORT', score: 80,
  price: 120, ema50: 100, ema200: 80, atr14: 10,
  support: 100, resistance: 107, rsi14: 55, weeklyRsi14: 58,
  macdHistogram: 1, volumeRatio: 1.2, relativeStrength20: 3,
  relativeStrength60: 5, week52High: 108, week52Low: 70,
  earningsDays: null, pe: null,
})
assert.ok((poorRrPullback.riskRewardAtEntry ?? Infinity) < 1.5, 'A close structural target must be able to produce R:R below 1.5')
assert.equal(poorRrPullback.decision, 'SKIP_POOR_RR', 'A pullback with R:R below 1.5 must be skipped')

const firstTranche = stockCheck.buildStockCheck({
  trend: 'UPTREND', setup: 'PULLBACK', score: 80,
  price: 103, ema50: 100, ema200: 90, atr14: 2,
  support: 98, resistance: 120, rsi14: 56, weeklyRsi14: 59,
  macdHistogram: 0.8, volumeRatio: 1.1, relativeStrength20: 4,
  relativeStrength60: 9, week52High: 125, week52Low: 72,
  earningsDays: 20, pe: 26,
})
assert.equal(firstTranche.decision, 'BUY_NOW', 'Strong uptrend slightly above entry may permit a first tranche')
assert.equal(firstTranche.buyMode, 'FIRST_TRANCHE', 'First-tranche BUY_NOW must be explicitly labeled')
assert.match(firstTranche.decisionLabel, /ไม้แรก/, 'First-tranche label must be visible to the user')
assert.ok((firstTranche.riskRewardNow ?? 0) >= 1.25, 'First tranche must use acceptable R:R from the live price')
const firstTrancheLabelInput = (overrides = {}) => ({
  decision: 'BUY_NOW', buyMode: 'FIRST_TRANCHE', price: 100,
  entryZone: { low: 98, high: 99.3 }, rrAtEntry: 2, riskRewardNow: 1.8,
  ...overrides,
})
const ddogLikeLabelInput = firstTrancheLabelInput({ price: 100.7, entryZone: { low: 98, high: 100 } })
assert.equal(todayCandidates.opportunityLabel(ddogLikeLabelInput), 'ซื้อไม้แรก', 'First tranche above Entry Zone must use the separate first-buy label')
assert.equal(todayCandidates.firstTrancheLabelReason(ddogLikeLabelInput), 'ราคาเหนือ Entry Zone', 'Out-of-zone first tranche must explain the price location')
const maLikeLabelInput = firstTrancheLabelInput({ price: 99, entryZone: { low: 98, high: 100 }, riskRewardNow: 1.44 })
assert.equal(todayCandidates.opportunityLabel(maLikeLabelInput), 'ซื้อไม้แรก', 'First tranche with live R:R below 1.5 must use the separate first-buy label')
assert.equal(todayCandidates.firstTrancheLabelReason(maLikeLabelInput), 'R:R NOW ต่ำกว่า 1.5', 'Low live R:R first tranche must explain the label')
const standardFirstTrancheLabelInput = firstTrancheLabelInput({ price: 99, entryZone: { low: 98, high: 100 }, riskRewardNow: 1.5 })
assert.equal(todayCandidates.opportunityLabel(standardFirstTrancheLabelInput), 'ซื้อได้ตอนนี้', 'In-zone first tranche with live R:R >= 1.5 may use the standard buy-now label')
assert.equal(todayCandidates.firstTrancheLabelReason(standardFirstTrancheLabelInput), null, 'In-zone first tranche with live R:R >= 1.5 needs no qualification')

const structuralDipFirstTranche = stockCheck.buildStockCheck({
  trend: 'SIDEWAYS', setup: 'NEAR_SUPPORT', score: 64,
  price: 98, ema50: 100, ema200: 90, atr14: 2,
  support: 95, resistance: 115, rsi14: 52, weeklyRsi14: 55,
  macdHistogram: -0.1, volumeRatio: 0.9, relativeStrength20: 1,
  relativeStrength60: 8, week52High: 120, week52Low: 70,
  earningsDays: 20, pe: 24,
})
assert.equal(structuralDipFirstTranche.decision, 'BUY_NOW', 'Controlled dip under EMA50 with intact support should permit a first tranche')
assert.equal(structuralDipFirstTranche.buyMode, 'FIRST_TRANCHE', 'Controlled structural dip must be labeled as first tranche, never standard BUY_NOW')
assert.match(structuralDipFirstTranche.summary, /ช้อนไม้แรก/, 'Structural dip first tranche should explain the dip-buy intent')
assert.ok((structuralDipFirstTranche.riskRewardNow ?? 0) >= 1.25, 'Structural dip first tranche must keep live R:R gate')

const brokenSupportDip = stockCheck.buildStockCheck({
  trend: 'SIDEWAYS', setup: 'WAIT', score: 70,
  price: 96, ema50: 100, ema200: 90, atr14: 2,
  support: 97, resistance: 115, rsi14: 50, weeklyRsi14: 54,
  macdHistogram: -0.1, volumeRatio: 0.9, relativeStrength20: 1,
  relativeStrength60: 7, week52High: 120, week52Low: 70,
  earningsDays: 20, pe: 24,
})
assert.notEqual(brokenSupportDip.decision, 'BUY_NOW', 'A dip below support must not qualify as first-tranche BUY_NOW')

const insideButPoorRr = stockCheck.buildStockCheck({
  trend: 'UPTREND', setup: 'NEAR_SUPPORT', score: 77,
  price: 100.25, ema50: 99.5, ema200: 90, atr14: 2,
  support: 99, resistance: 102, rsi14: 54, weeklyRsi14: 57,
  macdHistogram: 0.4, volumeRatio: 1.1, relativeStrength20: 3,
  relativeStrength60: 7, week52High: 102, week52Low: 75,
  earningsDays: 20, pe: 24,
})
assert.equal(insideButPoorRr.decision, 'WATCH', 'Being inside Entry Zone with poor live R:R must not say wait for a pullback')
assert.match(insideButPoorRr.summary, /Entry Zone/, 'In-zone WATCH should explain that price is already in the Entry Zone')
assert.equal(insideButPoorRr.target2Basis, 'plan-extension', 'Target 2 should identify a plan extension when the 52-week high is below its modeled floor')

const chasedTarget = stockCheck.buildStockCheck({
  trend: 'UPTREND', setup: 'MOMENTUM', score: 82,
  price: 95.9, ema50: 90, ema200: 83, atr14: 1.5,
  support: 89, resistance: 96.3, rsi14: 68, weeklyRsi14: 64,
  macdHistogram: 0.2, volumeRatio: 0.95, relativeStrength20: 8,
  relativeStrength60: 15, week52High: 100, week52Low: 70,
  earningsDays: 30, pe: 16,
})
assert.notEqual(chasedTarget.decision, 'BUY_NOW', 'Price near Target 1 must not become first-tranche BUY_NOW just because planned-entry R:R is strong')

const avoid = stockCheck.buildStockCheck({
  trend: 'DOWNTREND', setup: 'AVOID', score: 30,
  price: 90, ema50: 100, ema200: 110, atr14: 3,
  support: 95, resistance: 105, rsi14: 38, weeklyRsi14: 40,
  macdHistogram: -1, volumeRatio: 0.8, relativeStrength20: -8,
  relativeStrength60: -15, week52High: 130, week52Low: 80,
  earningsDays: 20, pe: 20,
})
assert.equal(avoid.decision, 'AVOID', 'Material breakdown plus broad weakness must remain AVOID')

const ordinaryDowntrend = stockCheck.buildStockCheck({
  trend: 'DOWNTREND', setup: 'WAIT', score: 52,
  price: 100, ema50: 104, ema200: 110, atr14: 2.5,
  support: 98, resistance: 108, rsi14: 43, weeklyRsi14: 47,
  macdHistogram: -0.2, volumeRatio: 1.0, relativeStrength20: -2,
  relativeStrength60: -3, week52High: 125, week52Low: 85,
  earningsDays: 20, pe: 23,
})
assert.notEqual(ordinaryDowntrend.decision, 'AVOID', 'A normal downtrend without breakdown/severe weakness must not be auto-AVOID')
assert.equal(ordinaryDowntrend.decision, 'WATCH', 'Downtrend with resistance more than 3% away should be watch-only')
assert.match(ordinaryDowntrend.summary, /ห่างแนวต้าน 8\.0%/, 'Distant-breakout WATCH must include the exact distance')

const slightSupportDip = stockCheck.buildStockCheck({
  trend: 'DOWNTREND', setup: 'WAIT', score: 50,
  price: 98.8, ema50: 103, ema200: 108, atr14: 2.3,
  support: 100, resistance: 107, rsi14: 42, weeklyRsi14: 46,
  macdHistogram: -0.1, volumeRatio: 1.0, relativeStrength20: -2,
  relativeStrength60: -4, week52High: 122, week52Low: 84,
  earningsDays: 20, pe: 22,
})
assert.notEqual(slightSupportDip.decision, 'AVOID', 'A sub-2% support dip must not be treated as material breakdown')

const eventRisk = stockCheck.buildStockCheck({
  trend: 'UPTREND', setup: 'NEAR_SUPPORT', score: 85,
  price: 100, ema50: 99, ema200: 90, atr14: 2,
  support: 99, resistance: 115, rsi14: 55, weeklyRsi14: 58,
  macdHistogram: 1, volumeRatio: 1.4, relativeStrength20: 5,
  relativeStrength60: 10, week52High: 120, week52Low: 70,
  earningsDays: 2, pe: 25,
})
assert.equal(eventRisk.decision, 'WATCH', 'Earnings within 3 days must block BUY_NOW')

const nearEventFirstTranche = stockCheck.buildStockCheck({
  trend: 'UPTREND', setup: 'PULLBACK', score: 82,
  price: 103, ema50: 100, ema200: 90, atr14: 2,
  support: 98, resistance: 120, rsi14: 56, weeklyRsi14: 59,
  macdHistogram: 0.8, volumeRatio: 1.1, relativeStrength20: 4,
  relativeStrength60: 9, week52High: 125, week52Low: 72,
  earningsDays: 5, pe: 26,
})
assert.notEqual(nearEventFirstTranche.buyMode, 'FIRST_TRANCHE', 'First-tranche BUY_NOW must stay blocked inside the 7-day earnings window')

const saneTechnicalRange = stockCheck.sanitizeWeek52Range(429.32, 445, 160, 2535, 1160)
assert.deepEqual(saneTechnicalRange, { high: 445, low: 160 }, 'Same-ticker historical 52W range must override absurd provider-scale metrics')
const rejectedProviderRange = stockCheck.sanitizeWeek52Range(95.93, null, null, 3591, 2554)
assert.deepEqual(rejectedProviderRange, { high: null, low: null }, 'Implausible provider-only 52W range must fail closed instead of creating absurd targets')
const acceptedProviderRange = stockCheck.sanitizeWeek52Range(100, null, null, 130, 75)
assert.deepEqual(acceptedProviderRange, { high: 130, low: 75 }, 'Plausible provider 52W range should remain a valid fallback')

const scannerWait = stockScanner.scoreScannerCandidate({
  trend: 'DOWNTREND',
  rsi14: 43,
  weeklyRsi14: 47,
  macdHistogram: -0.2,
  lastClose: 100,
  ema50: 104,
  support: 98,
  resistance: 108,
  volumeRatio: 1,
  week52High: 125,
  week52Low: 85,
  relativeStrength20: -2,
  relativeStrength60: -3,
  earningsDays: 20,
})
assert.equal(scannerWait.setup, 'WAIT', 'Scanner must distinguish ordinary downtrend from true AVOID')

const scannerAvoid = stockScanner.scoreScannerCandidate({
  trend: 'DOWNTREND',
  rsi14: 37,
  weeklyRsi14: 39,
  macdHistogram: -1,
  lastClose: 90,
  ema50: 100,
  support: 95,
  resistance: 105,
  volumeRatio: 0.8,
  week52High: 130,
  week52Low: 80,
  relativeStrength20: -8,
  relativeStrength60: -15,
  earningsDays: 20,
})
assert.equal(scannerAvoid.setup, 'AVOID', 'Scanner must keep AVOID for material breakdown / severe weakness')

for (const path of [
  'app/api/stock-check/route.ts',
  'app/api/stock-check/ai/route.ts',
  'components/portfolio/StockCheckPanel.tsx',
  'components/portfolio/ScannerWorkspace.tsx',
  'components/portfolio/TodayOpportunities.tsx',
  'components/navigation/AppTabs.tsx',
  'lib/stock-check-data.ts',
  'lib/stock-check-ai.ts',
  'lib/atr.ts',
]) assert.equal(fs.existsSync(path), true, `${path} is required`)

const route = fs.readFileSync('app/api/stock-check/route.ts', 'utf8')
assert.match(route, /parseSymbol/, 'Stock Check must validate arbitrary ticker input')
assert.match(route, /loadStockCheck/, 'Stock Check must use the shared data service')

const data = fs.readFileSync('lib/stock-check-data.ts', 'utf8')
assert.match(data, /getTechnicalIndicators\('SPY'\)/, 'Stock Check must compare Relative Strength against SPY')
assert.match(data, /scannerSupport/, 'Stock Check must use scanner-safe support')
assert.match(data, /scannerVolumeRatio/, 'Stock Check must use scanner-safe volume ratio')
assert.match(data, /getAtr14/, 'Stock Check must use ATR14 for volatility-aware planning')
assert.match(data, /sanitizeWeek52Range/, 'Stock Check must sanitize 52W range before scoring or target planning')
assert.match(data, /providerQuoteTimestamp\(quote\?\.t\)/, 'Stock Check must carry the provider quote timestamp without substituting request time')

const atr = fs.readFileSync('lib/atr.ts', 'utf8')
assert.match(atr, /ATR\.calculate/, 'ATR14 must use the technical indicator implementation')

const ui = fs.readFileSync('components/portfolio/StockCheckPanel.tsx', 'utf8')
assert.match(ui, /Entry Zone/, 'Stock Check UI must expose Entry Zone')
assert.match(ui, /Stop Loss/, 'Stock Check UI must expose Stop Loss')
assert.match(ui, /ขนาดสถานะจากงบ/, 'Stock Check UI must expose budget-based position sizing')
assert.match(ui, /วิเคราะห์เชิงลึกด้วย AI/, 'AI analysis must remain an explicit optional action')
assert.match(ui, /\/api\/watchlist/, 'Stock Check must reuse the existing Watchlist API')

const workspace = fs.readFileSync('components/portfolio/ScannerWorkspace.tsx', 'utf8')
assert.match(workspace, /🔬 เช็กหุ้น/, 'Scanner workspace must expose the Stock Check view')
assert.match(workspace, /OpportunityHub/, 'Existing Scanner/Watchlist workspace must remain intact')
assert.match(workspace, /🔥 โอกาสวันนี้/, 'Scanner workspace must expose the Today Opportunity Radar')
assert.match(workspace, /TodayOpportunities/, 'Today Opportunity Radar must be wired into Scanner workspace')

const today = fs.readFileSync('components/portfolio/TodayOpportunities.tsx', 'utf8')
assert.match(today, /chunkScannerSymbols\(uniqueSymbols\)/, 'Today radar must chunk the combined deduplicated universe')
assert.match(today, /shouldShowEarningsUnknownBanner\(results\)/, 'Today radar must decide the banner from validated results only')
assert.match(today, /ข้อมูล Earnings ใช้ไม่ได้ ผลถูกลดคะแนน/, 'Today radar must show the Thai unknown-earnings warning banner')
assert.match(today, /firstTrancheLabelReason\(/, 'Today radar must show a reason beneath qualified first-tranche labels')
assert.match(today, /new URLSearchParams\(\{ universe: 'all', symbols: batch\.join\(','\) \}\)/, 'Each Today radar scanner request must contain only one bounded symbol batch')
assert.match(today, /for \(const batch of batches\)/, 'Today radar batches must be requested sequentially to preserve provider concurrency')
assert.doesNotMatch(today, /ใกล้ซื้อ/, 'Today radar must not collapse decisions into the old near-buy label')
assert.match(today, /earningsUnknownPenalty/, 'Today radar must disclose the penalty when the earnings provider is unknown')
assert.match(today, /priceAsOf/, 'Today radar must show per-ticker price time separately from scan completion')
assert.match(today, /categoryScores\.relativeStrength/, 'Today radar must show all six score categories')
assert.match(today, /FINALIST_LIMIT = 6/, 'Today radar must cap live Stock Check validation to six finalists')
assert.match(today, /\/api\/stock-check\?symbol=/, 'Today radar finalists must be revalidated with live Stock Check')
assert.match(fs.readFileSync('lib/today-candidates.ts', 'utf8'), /isStructuralPullback/, 'Today radar must surface controlled EMA50 pullback candidates')
const scannerRoute = fs.readFileSync('app/api/scanner/route.ts', 'utf8')
assert.match(scannerRoute, /dedupeScannerSymbols\(Object\.values\(SCANNER_UNIVERSES\)\)/, 'Combined scanner route must deduplicate symbols before scanOne provider calls')

const scannerPage = fs.readFileSync('app/scanner/page.tsx', 'utf8')
assert.match(scannerPage, /ScannerWorkspace/, 'Dedicated scanner page must render the combined workspace')

const globalNav = fs.readFileSync('components/navigation/AppTabs.tsx', 'utf8')
assert.match(globalNav, /data-app-shell-nav/, 'Authenticated navigation must expose the global utility shell')
assert.match(globalNav, /stock-portfolio-theme/, 'Theme toggle must persist the existing global theme preference')
assert.match(globalNav, /\/api\/pin\/change/, 'Change PIN must be available from the global account menu')
assert.match(globalNav, /\/api\/pin\/lock/, 'Global controls must support immediate PIN lock')
assert.match(globalNav, /auth\.signOut/, 'Global account menu must support logout')

const ai = fs.readFileSync('lib/stock-check-ai.ts', 'utf8')
assert.match(ai, /model === PRIMARY_MODEL \? 'high' : 'medium'/, 'Deep Stock Check must use high reasoning on the primary 120B model')
assert.match(ai, /const PRIMARY_MODEL = 'openai\/gpt-oss-120b'/, 'Deep Stock Check primary model must remain GPT-OSS 120B')
assert.match(ai, /temperature: 0\.2/, 'Deep Stock Check should keep analysis temperature conservative')

const stockCheckUi = fs.readFileSync('components/portfolio/StockCheckPanel.tsx', 'utf8')
assert.match(stockCheckUi, /formatStockCheckFreshness\(/, 'Stock Check must label provider quote time separately from check time')
assert.match(stockCheckUi, /result\.scannerReasons/, 'Stock Check must expose the existing scanner scoring reasons')
assert.match(stockCheckUi, /เหตุผล\/ข้อสังเกตจาก Stock Scanner/, 'Scanner reasons and warnings must be visually distinguished from plan reasons')
assert.match(stockCheckUi, /formatTarget2Context\(/, 'Target 2 must explain its reference basis')
assert.match(stockCheckUi, /R:R คำนวณถึง Target 1/, 'R:R display must say it is measured to Target 1')
assert.match(stockCheckUi, /AI ส่งรูปแบบที่อ่านไม่ได้ จึงใช้สรุปจาก Stock Check แทน/, 'AI parse fallback must be disclosed to the user')

console.log('✓ Stock Check synthetic regression tests passed')
