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

const buyNow = stockCheck.buildStockCheck({
  trend: 'UPTREND', setup: 'NEAR_SUPPORT', score: 82,
  price: 100.5, ema50: 99.5, ema200: 90, atr14: 2,
  support: 100, resistance: 115, rsi14: 55, weeklyRsi14: 58,
  macdHistogram: 1, volumeRatio: 1.3, relativeStrength20: 5,
  relativeStrength60: 12, week52High: 120, week52Low: 70,
  earningsDays: 20, pe: 25,
})
assert.equal(buyNow.decision, 'BUY_NOW', 'Strong near-support setup should permit BUY_NOW')
assert.ok((buyNow.riskRewardAtEntry ?? 0) >= 1.5, 'BUY_NOW plan must have acceptable R:R')
assert.ok((buyNow.stopLoss ?? 999) < (buyNow.entryZone?.low ?? 0), 'Stop must stay below planned entry')

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

const atr = fs.readFileSync('lib/atr.ts', 'utf8')
assert.match(atr, /ATR\.calculate/, 'ATR14 must use the technical indicator implementation')

const ui = fs.readFileSync('components/portfolio/StockCheckPanel.tsx', 'utf8')
assert.match(ui, /Entry Zone/, 'Stock Check UI must expose Entry Zone')
assert.match(ui, /Stop Loss/, 'Stock Check UI must expose Stop Loss')
assert.match(ui, /Position Sizing/, 'Stock Check UI must expose budget-based position sizing')
assert.match(ui, /วิเคราะห์เชิงลึกด้วย AI/, 'AI analysis must remain an explicit optional action')
assert.match(ui, /\/api\/watchlist/, 'Stock Check must reuse the existing Watchlist API')

const workspace = fs.readFileSync('components/portfolio/ScannerWorkspace.tsx', 'utf8')
assert.match(workspace, /🔬 เช็กหุ้น/, 'Scanner workspace must expose the Stock Check view')
assert.match(workspace, /OpportunityHub/, 'Existing Scanner/Watchlist workspace must remain intact')

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

console.log('✓ Stock Check v1.26.0 regression tests passed')
