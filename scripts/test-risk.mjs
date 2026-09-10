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
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
}

const risk = await importTsModule('lib/risk.ts')

const full = risk.calculateRiskSnapshot([
  { symbol: 'AAA', shares: 10, current_price: 100, industry: 'Technology', stop_loss: 90 },
  { symbol: 'BBB', shares: 5, current_price: 200, industry: 'Financial Services', stop_loss: 150 },
], 1000)
assert.equal(full.summary.equity_market_value, 2000)
assert.equal(full.summary.investable_portfolio_value, 3000)
assert.equal(full.summary.cash_pct, 33.33)
assert.equal(full.summary.stop_coverage_pct, 100)
assert.equal(full.summary.quantified_stop_risk_amount, 350)
assert.equal(full.summary.max_stop_loss_amount, 350)
assert.equal(full.summary.max_stop_loss_pct, 11.67)
assert.equal(full.positions[0].weight_pct, 33.33)

const partial = risk.calculateRiskSnapshot([
  { symbol: 'AAA', shares: 10, current_price: 100, industry: 'Technology', stop_loss: 90 },
  { symbol: 'BBB', shares: 5, current_price: 200, industry: 'Technology', stop_loss: null },
], 0)
assert.equal(partial.summary.stop_coverage_pct, 50)
assert.equal(partial.summary.max_stop_loss_amount, null)
assert.deepEqual(partial.summary.unprotected_symbols, ['BBB'])
assert.equal(partial.sectors[0].industry, 'Technology')
assert.equal(partial.sectors[0].weight_pct, 100)

const breached = risk.calculateRiskSnapshot([
  { symbol: 'AAA', shares: 10, current_price: 100, industry: 'Technology', stop_loss: 105 },
], 0)
assert.equal(breached.positions[0].stop_state, 'BREACHED')
assert.deepEqual(breached.summary.breached_stop_symbols, ['AAA'])
assert.equal(breached.summary.max_stop_loss_amount, null)

const shock = risk.calculateShockScenario(full, 'aaa', -20)
assert.ok(shock)
assert.equal(shock.symbol, 'AAA')
assert.equal(shock.impact_amount, -200)
assert.equal(shock.impact_pct_portfolio, -6.67)
assert.equal(shock.new_portfolio_value, 2800)

for (const path of [
  'lib/risk.ts',
  'lib/company-profile.ts',
  'app/api/risk/route.ts',
  'app/risk/page.tsx',
  'app/risk/error.tsx',
  'components/portfolio/RiskDashboard.tsx',
]) assert.equal(fs.existsSync(path), true, `${path} is required`)

const api = fs.readFileSync('app/api/risk/route.ts', 'utf8')
assert.match(api, /get_decrypted_holdings/, 'Risk must read encrypted Holdings through service RPC')
assert.match(api, /get_decrypted_trade_plans/, 'Risk should use Trade Plan stops when available')
assert.match(api, /getCompanyProfiles/, 'Risk must use a real industry source rather than invent sectors')
assert.doesNotMatch(api, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/, 'Risk API must remain read-only')
assert.doesNotMatch(api, /save_trade_plan|save_portfolio_transaction/, 'Risk must not execute trades or mutate plans')

const ui = fs.readFileSync('components/portfolio/RiskDashboard.tsx', 'utf8')
assert.match(ui, /🛡️ Portfolio Risk/, 'Risk workspace title is required')
assert.match(ui, /Largest Position/, 'Position concentration must be visible')
assert.match(ui, /Sector \/ Industry Concentration/, 'Industry concentration must be visible')
assert.match(ui, /Cash Buffer/, 'Cash percentage must be visible')
assert.match(ui, /Loss ถ้า Stop ทำงาน/, 'Portfolio stop loss must be visible')
assert.match(ui, /Stress Scenario/, 'Stress scenario must be available')
assert.match(ui, /-20/, 'A -20% shock preset is required')
assert.match(ui, /Rebalance \/ Risk Flags/, 'Deterministic rebalance flags must be visible')
assert.match(ui, /ไม่สร้าง BUY\/SELL/, 'No-auto-trade safety must be explicit')

const nav = fs.readFileSync('components/navigation/AppTabs.tsx', 'utf8')
assert.match(nav, /href: '\/risk'/, 'Risk must be a main navigation tab')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
assert.match(pkg.scripts['test:critical'], /test-risk\.mjs/, 'Risk regression must be part of the critical build gate')

console.log('✓ Portfolio Risk regression tests passed')
