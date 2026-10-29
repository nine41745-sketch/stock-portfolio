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
  price: 100, ema50: 99.5, ema200: 90, atr14: 2,
  support: 99, resistance: 103, rsi14: 54, weeklyRsi14: 57,
  macdHistogram: 0.4, volumeRatio: 1.1, relativeStrength20: 3,
  relativeStrength60: 7, week52High: 104, week52Low: 75,
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
assert.equal(ordinaryDowntrend.decision, 'WAIT_FOR_BREAKOUT', 'Downtrend with intact support should wait for confirmation')

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
assert.match(today, /const UNIVERSES = \['ai', 'semis', 'growth', 'quality'\]/, 'Today radar must scan all four built-in universes')
assert.match(today, /FINALIST_LIMIT = 6/, 'Today radar must cap live Stock Check validation to six finalists')
assert.match(today, /\/api\/scanner\?universe=/, 'Today radar must reuse deterministic scanner data')
assert.match(today, /\/api\/stock-check\?symbol=/, 'Today radar finalists must be revalidated with live Stock Check')
assert.match(fs.readFileSync('lib/today-candidates.ts', 'utf8'), /isStructuralPullback/, 'Today radar must surface controlled EMA50 pullback candidates')

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
