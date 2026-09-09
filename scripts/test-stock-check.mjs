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
assert.equal(avoid.decision, 'AVOID', 'Downtrend/breakdown must fail closed to AVOID')

const eventRisk = stockCheck.buildStockCheck({
  trend: 'UPTREND', setup: 'NEAR_SUPPORT', score: 85,
  price: 100, ema50: 99, ema200: 90, atr14: 2,
  support: 99, resistance: 115, rsi14: 55, weeklyRsi14: 58,
  macdHistogram: 1, volumeRatio: 1.4, relativeStrength20: 5,
  relativeStrength60: 10, week52High: 120, week52Low: 70,
  earningsDays: 2, pe: 25,
})
assert.equal(eventRisk.decision, 'WATCH', 'Earnings within 3 days must block BUY_NOW')

for (const path of [
  'app/api/stock-check/route.ts',
  'app/api/stock-check/ai/route.ts',
  'components/portfolio/StockCheckPanel.tsx',
  'components/portfolio/ScannerWorkspace.tsx',
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

console.log('✓ Stock Check regression tests passed')
