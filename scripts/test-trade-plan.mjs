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

const validation = await importTsModule('lib/trade-plan-validation.ts')
const math = await importTsModule('lib/trade-plan.ts')

const plan = validation.parseTradePlanInput({
  symbol: 'nvda',
  status: 'waiting',
  source: 'stock_check',
  entry_low: '100',
  entry_high: '110',
  add_zone_low: '92',
  add_zone_high: '96',
  stop_loss: '95',
  target1: '125',
  target2: '140',
  budget: '1000',
  note: 'test',
})
assert.equal(plan.symbol, 'NVDA')
assert.equal(plan.status, 'WAITING')
assert.equal(plan.source, 'STOCK_CHECK')
assert.equal(plan.entry_high, 110)
assert.equal(plan.planned_shares, null)

assert.throws(() => validation.parseTradePlanInput({
  symbol: 'NVDA', entry_low: 100, entry_high: 110, stop_loss: 106,
}), /Stop Loss/)
assert.throws(() => validation.parseTradePlanInput({
  symbol: 'NVDA', entry_low: 100, entry_high: 110, add_zone_low: 90,
}), /Add Zone/)
assert.throws(() => validation.parseTradePlanInput({
  symbol: 'NVDA', entry_low: 100, entry_high: 110, target1: 130, target2: 120,
}), /Target 2/)

const metrics = math.calculateTradePlanMetrics({
  entry_low: 100,
  entry_high: 110,
  stop_loss: 95,
  target1: 125,
  target2: 145,
  budget: 1000,
  planned_shares: null,
})
assert.equal(metrics.entry_mid, 105)
assert.equal(metrics.risk_per_share, 10)
assert.equal(metrics.risk_amount, 95.24)
assert.equal(metrics.risk_pct_budget, 9.52)
assert.equal(metrics.rr_target1, 2)
assert.equal(metrics.rr_target2, 4)

for (const path of [
  'app/api/trade-plans/route.ts',
  'app/trade-plan/page.tsx',
  'app/trade-plan/error.tsx',
  'components/portfolio/TradePlanWorkspace.tsx',
  'lib/trade-plan.ts',
  'lib/trade-plan-validation.ts',
  'supabase/migration_trade_plan_v1.23.0.sql',
]) assert.equal(fs.existsSync(path), true, `${path} is required`)

const api = fs.readFileSync('app/api/trade-plans/route.ts', 'utf8')
assert.match(api, /createServiceClient/, 'Sensitive Trade Plan values must stay server-side')
assert.match(api, /get_decrypted_trade_plans/, 'GET must decrypt through service-only RPC')
assert.match(api, /save_trade_plan/, 'Writes must encrypt through service-only RPC')
assert.match(api, /migration_trade_plan_v1\.23\.0\.sql/, 'Missing migration must return an explicit recovery path')
assert.doesNotMatch(api, /\.from\(['"]holdings['"]\)/, 'Trade Plan must not mutate/read Holdings as a side effect')
assert.doesNotMatch(api, /portfolio_transactions|save_portfolio_transaction/, 'Trade Plan must not auto-write Transaction Ledger')

const migration = fs.readFileSync('supabase/migration_trade_plan_v1.23.0.sql', 'utf8')
assert.match(migration, /budget_enc\s+TEXT/, 'Budget must be encrypted at rest')
assert.match(migration, /stop_loss_enc\s+TEXT/, 'Stop must be encrypted at rest')
assert.match(migration, /note_enc\s+TEXT/, 'Trade thesis note must be encrypted at rest')
assert.match(migration, /ENABLE ROW LEVEL SECURITY/, 'Trade Plan table must enable RLS')
assert.match(migration, /trade_plans_one_active_symbol_idx/, 'Only one active plan per symbol should be allowed')
assert.match(migration, /REVOKE ALL ON TABLE public\.trade_plans FROM PUBLIC, anon, authenticated/, 'Browser sessions must not read ciphertext')
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.save_trade_plan[\s\S]*service_role/, 'Encryption RPC must be service-role only')
assert.match(migration, /does NOT mutate Holdings or Transaction Ledger/, 'Migration safety boundary must be explicit')

const ui = fs.readFileSync('components/portfolio/TradePlanWorkspace.tsx', 'utf8')
assert.match(ui, /🎯 Trade Plan/, 'Trade Plan workspace title is required')
assert.match(ui, /Planned Entry/, 'Planned Entry inputs are required')
assert.match(ui, /Add Zone/, 'Add Zone inputs are required')
assert.match(ui, /Max Loss @ Stop/, 'Plan risk amount must be visible')
assert.match(ui, /R:R Target 1/, 'Risk\/reward must be visible')
assert.match(ui, /รออนุมัติ Migration/, 'Preview must not pretend persistence works before migration')
assert.match(ui, /จะไม่เปลี่ยนจำนวนหุ้น/, 'No-auto-sync safety must be explicit')
assert.match(ui, /ไม่สร้าง BUY\/SELL อัตโนมัติ/, 'Status changes must not imply trade execution')

const stockCheck = fs.readFileSync('components/portfolio/StockCheckPanel.tsx', 'utf8')
assert.match(stockCheck, /ส่งเข้า Trade Plan/, 'Stock Check must link its computed plan into Trade Plan')
assert.match(stockCheck, /\/trade-plan\?/, 'Stock Check integration must use Trade Plan route prefill')

const nav = fs.readFileSync('components/navigation/AppTabs.tsx', 'utf8')
assert.match(nav, /href: '\/trade-plan'/, 'Trade Plan must be a main navigation tab')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
assert.match(pkg.scripts['test:critical'], /test-trade-plan\.mjs/, 'Trade Plan regression must be part of the critical build gate')

console.log('✓ Trade Plan regression tests passed')
