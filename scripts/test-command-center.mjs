import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

async function importTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020, strict: true },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${filePath} transpile diagnostics: ${errors.map(e => e.messageText).join('; ')}`)
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
}

const simulator = await importTsModule('lib/tranche-simulator.ts')

const three = simulator.simulateTranches({
  budget: 900,
  availableCash: 1000,
  trancheCount: 3,
  decision: 'BUY_ON_PULLBACK',
  currentPrice: 110,
  entryLow: 90,
  entryHigh: 100,
  stopLoss: 85,
  target1: 120,
  target2: 135,
  existingShares: 0,
  existingMarketValue: 0,
  investablePortfolioValue: 5000,
})
assert.ok(three)
assert.equal(three.tranches.length, 3)
assert.deepEqual(three.tranches.map(x => x.price), [100, 95, 90])
assert.equal(three.plannedSpend, 900)
const uneven = simulator.simulateTranches({
  budget: 100,
  availableCash: 100,
  trancheCount: 3,
  decision: 'BUY_ON_PULLBACK',
  currentPrice: 110,
  entryLow: 90,
  entryHigh: 100,
  stopLoss: 85,
  target1: 120,
  target2: 135,
  existingShares: 0,
  existingMarketValue: 0,
  investablePortfolioValue: 1000,
})
assert.ok(uneven)
assert.equal(uneven.plannedSpend, 100, 'Tranche cents must sum exactly to the executable budget')
assert.deepEqual(uneven.tranches.map(x => x.amount), [33.34, 33.33, 33.33])
assert.equal(three.cashLimited, false)
assert.ok(three.stopRiskAmount > 0)
assert.ok(three.target1GainAmount > 0)

const buyNow = simulator.simulateTranches({
  budget: 600,
  availableCash: 400,
  trancheCount: 2,
  decision: 'BUY_NOW',
  currentPrice: 102,
  entryLow: 95,
  entryHigh: 100,
  stopLoss: 90,
  target1: 120,
  target2: 130,
  existingShares: 10,
  existingMarketValue: 1020,
  investablePortfolioValue: 4000,
})
assert.ok(buyNow)
assert.equal(buyNow.executableBudget, 400)
assert.equal(buyNow.cashLimited, true)
assert.equal(buyNow.tranches[0].price, 102, 'BUY_NOW first leg must use current price')
assert.equal(buyNow.tranches[1].price, 95)
assert.equal(buyNow.postPositionValue, 1420)
assert.equal(buyNow.concentrationLevel, 'HIGH')

const noBudget = simulator.simulateTranches({
  budget: 0,
  availableCash: 1000,
  trancheCount: 3,
  decision: 'WATCH',
  currentPrice: 100,
  entryLow: 95,
  entryHigh: 105,
  stopLoss: 90,
  target1: 120,
  target2: null,
  existingShares: 0,
  existingMarketValue: 0,
  investablePortfolioValue: 1000,
})
assert.equal(noBudget, null)

for (const file of [
  'app/api/portfolio-command/route.ts',
  'components/portfolio/StockCommandCenter.tsx',
  'components/portfolio/StockCheckPanel.tsx',
]) assert.equal(fs.existsSync(file), true, `${file} is required`)

const api = fs.readFileSync('app/api/portfolio-command/route.ts', 'utf8')
assert.match(api, /resolveActivePortfolio/, 'Command Center must use the selected portfolio')
assert.match(api, /p_portfolio_id/, 'Command Center encrypted RPC reads must be portfolio scoped')
assert.match(api, /portfolio_id/, 'Command Center settings must be portfolio scoped')
assert.match(api, /side_effects:[\s\S]*Read-only/, 'Command Center must explicitly stay read-only')

actionSafety(fs.readFileSync('components/portfolio/StockCommandCenter.tsx', 'utf8'))
function actionSafety(ui) {
  assert.match(ui, /ไม่มีการส่งคำสั่งซื้อหรือแก้ Holdings อัตโนมัติ/, 'UI must state that simulator has no order/holding side effects')
  assert.match(ui, /cashLimited/, 'Simulator UI must surface cash caps')
  assert.match(ui, /FIRST_TRANCHE/, 'First-tranche decision must remain visible')
}

const stockCheck = fs.readFileSync('components/portfolio/StockCheckPanel.tsx', 'utf8')
assert.match(stockCheck, /StockCommandCenter/, 'Stock Check must render Command Center')
assert.match(stockCheck, /buyMode: 'STANDARD' \| 'FIRST_TRANCHE' \| null/, 'Stock Check must retain buy mode from deterministic engine')

console.log('✓ Stock Command Center / Buy-Tranche Simulator regression tests passed')
