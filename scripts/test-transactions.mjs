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

const validation = await importTsModule('lib/transaction-validation.ts')

const buy = validation.parseTransactionInput({
  transaction_type: 'buy',
  symbol: 'nvda',
  shares: '2.5',
  price: '123.45',
  fee: '0.25',
  trade_date: '2026-09-10',
  note: 'test',
})
assert.equal(buy.transaction_type, 'BUY')
assert.equal(buy.symbol, 'NVDA')
assert.equal(buy.shares, 2.5)
assert.equal(buy.amount, null)

const opening = validation.parseTransactionInput({
  transaction_type: 'OPENING_POSITION',
  symbol: 'PLTR',
  shares: 10,
  price: 140,
  trade_date: '2026-09-10',
})
assert.equal(opening.fee, null, 'Opening position must not create a cash-flow fee')

const deposit = validation.parseTransactionInput({
  transaction_type: 'DEPOSIT',
  amount: 500,
  trade_date: '2026-09-10',
})
assert.equal(deposit.symbol, null)
assert.equal(deposit.amount, 500)

assert.throws(() => validation.parseTransactionInput({
  transaction_type: 'SELL',
  symbol: 'NVDA',
  shares: 0,
  price: 100,
  trade_date: '2026-09-10',
}), /จำนวนหุ้น/)

assert.throws(() => validation.parseTransactionInput({
  transaction_type: 'DIVIDEND',
  symbol: 'NVDA',
  amount: -1,
  trade_date: '2026-09-10',
}), /เงินปันผล/)

for (const path of [
  'app/api/transactions/route.ts',
  'app/transactions/page.tsx',
  'app/transactions/error.tsx',
  'components/portfolio/TransactionLedger.tsx',
  'lib/transaction-validation.ts',
  'supabase/migration_transactions_v1.21.0.sql',
]) assert.equal(fs.existsSync(path), true, `${path} is required`)

const api = fs.readFileSync('app/api/transactions/route.ts', 'utf8')
assert.match(api, /createServiceClient/, 'Transaction money fields must stay server-side')
assert.match(api, /get_decrypted_portfolio_transactions/, 'GET must decrypt through service-only RPC')
assert.match(api, /save_portfolio_transaction/, 'Writes must encrypt through service-only RPC')
assert.match(api, /buildReconciliation/, 'Ledger must compare calculated shares with holdings')
assert.doesNotMatch(api, /\/api\/holdings/, 'Transaction CRUD must not mutate Holdings through its API')

const migration = fs.readFileSync('supabase/migration_transactions_v1.21.0.sql', 'utf8')
assert.match(migration, /price_enc\s+TEXT/, 'Trade price must be encrypted at rest')
assert.match(migration, /amount_enc\s+TEXT/, 'Cash amount must be encrypted at rest')
assert.match(migration, /ENABLE ROW LEVEL SECURITY/, 'Transaction table must enable RLS')
assert.match(migration, /REVOKE ALL ON FUNCTION public\.save_portfolio_transaction[\s\S]*authenticated/, 'Encryption RPC must not be callable from authenticated browser clients')
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.save_portfolio_transaction[\s\S]*service_role/, 'Encryption RPC must be service-role only')

const ui = fs.readFileSync('components/portfolio/TransactionLedger.tsx', 'utf8')
assert.match(ui, /ยอดหุ้นตั้งต้น/, 'Existing holdings need an explicit opening-position path')
assert.match(ui, /ตรวจเทียบ Holdings/, 'UI must surface reconciliation')
assert.match(ui, /จะไม่เปลี่ยนจำนวนหุ้น/, 'UI must make no-auto-sync safety explicit')
assert.match(ui, /migration_transactions_v1\.21\.0\.sql/, 'Missing migration must have a clear recovery path')

const nav = fs.readFileSync('components/navigation/AppTabs.tsx', 'utf8')
assert.match(nav, /href: '\/transactions'/, 'Transactions must be a main navigation tab')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
assert.match(pkg.scripts['test:critical'], /test-transactions\.mjs/, 'Transaction regression test must be part of critical build gate')

console.log('✓ Transaction Ledger regression tests passed')
