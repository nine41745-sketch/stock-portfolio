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

const allocation = await importTsModule('lib/allocation.ts')

const snapshot = allocation.calculateAllocationSnapshot([
  { asset_key: 'AAA', current_value: 600 },
  { asset_key: 'BBB', current_value: 300 },
  { asset_key: 'DIME', current_value: 100 },
], [
  { asset_key: 'AAA', target_pct: 50 },
  { asset_key: 'BBB', target_pct: 30 },
  { asset_key: 'DIME', target_pct: 20 },
])
assert.equal(snapshot.total_value, 1000)
assert.equal(snapshot.target_total_pct, 100)
assert.equal(snapshot.targets_valid, true)
assert.equal(snapshot.rows.find(row => row.asset_key === 'AAA')?.status, 'OVER')
assert.equal(snapshot.rows.find(row => row.asset_key === 'DIME')?.status, 'UNDER')
assert.equal(snapshot.rows.find(row => row.asset_key === 'DIME')?.gap_amount, 100)

const targetOnly = allocation.calculateAllocationSnapshot([
  { asset_key: 'AAA', current_value: 1000 },
  { asset_key: 'DIME', current_value: 0 },
], [
  { asset_key: 'AAA', target_pct: 50 },
  { asset_key: 'NEW', target_pct: 40 },
  { asset_key: 'DIME', target_pct: 10 },
])
assert.equal(targetOnly.rows.find(row => row.asset_key === 'NEW')?.current_value, 0)
assert.equal(targetOnly.rows.find(row => row.asset_key === 'NEW')?.gap_amount, 400)

const plan = allocation.calculateNewMoneyPlan(snapshot, 500)
assert.ok(plan.length >= 1)
assert.equal(Math.round(plan.reduce((sum, item) => sum + item.amount, 0) * 100) / 100, 500)
assert.ok(plan.every(item => item.amount > 0))
assert.ok(plan.some(item => item.asset_key === 'DIME'), 'Underweight DIME target should receive new money')
assert.equal(plan.some(item => item.asset_key === 'ZERO'), false, 'Unknown/zero-target assets must not receive new money')

for (const path of [
  'lib/allocation.ts',
  'app/api/allocation-targets/route.ts',
  'components/portfolio/AllocationPlanner.tsx',
  'supabase/migration_allocation_targets_v1.31.0.sql',
  'supabase/verify_allocation_targets_v1.31.0.sql',
]) assert.equal(fs.existsSync(path), true, `${path} is required`)

const api = fs.readFileSync('app/api/allocation-targets/route.ts', 'utf8')
assert.match(api, /save_portfolio_allocation_targets/, 'Target save must use the atomic service-role RPC')
assert.match(api, /Target รวมต้องเท่ากับ 100%/, 'API must reject invalid target totals')
assert.match(api, /migration_allocation_targets_v1\.31\.0\.sql/, 'Missing migration must be recoverable')

const migration = fs.readFileSync('supabase/migration_allocation_targets_v1.31.0.sql', 'utf8')
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.portfolio_allocation_targets/, 'Allocation target table is required')
assert.match(migration, /UNIQUE \(user_id, portfolio_id, asset_key\)/, 'Targets must be unique per portfolio asset')
assert.match(migration, /allocation target total must equal 100/, 'Database must enforce a 100% snapshot total')
assert.match(migration, /SET search_path = ''/, 'Security-definer RPC must pin an empty search_path')
assert.match(migration, /FROM PUBLIC, anon, authenticated/, 'Save RPC must not be browser-callable')
assert.match(migration, /TO service_role/, 'Save RPC must be service-role only')

const ui = fs.readFileSync('components/portfolio/AllocationPlanner.tsx', 'utf8')
assert.match(ui, /Target Allocation \+ Rebalance/, 'Allocation workspace is required')
assert.match(ui, /DIME/, 'DIME must be represented as the portfolio cash asset')
assert.match(ui, /เงินในธนาคารไม่นำมารวม/, 'Bank cash exclusion must be explicit')
assert.match(ui, /Full Rebalance Gap/, 'Full rebalance delta view is required')
assert.match(ui, /เติมเงินใหม่โดยไม่ขาย/, 'No-sell new-money planner is required')
assert.match(ui, /ไม่สร้าง BUY\/SELL/, 'No-auto-trade safety must be explicit')

const riskUi = fs.readFileSync('components/portfolio/RiskDashboard.tsx', 'utf8')
assert.match(riskUi, /<AllocationPlanner positions=\{data\.positions\} dimeBalance=\{data\.balances\.dime_balance\} \/>/, 'Risk page must mount Allocation Planner')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
assert.match(pkg.scripts['test:critical'], /test-allocation\.mjs/, 'Allocation regression must be part of critical build gate')

console.log('✓ Target Allocation + Rebalance regression tests passed')
