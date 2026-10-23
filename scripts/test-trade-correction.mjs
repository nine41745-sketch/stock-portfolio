import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const migration = fs.readFileSync('supabase/20261023074534_atomic_trade_correction.sql', 'utf8')
assert.match(migration, /CREATE TRIGGER portfolio_transactions_protect_synced\s+BEFORE UPDATE OR DELETE ON public\.portfolio_transactions\s+FOR EACH ROW EXECUTE FUNCTION public\.prevent_synced_transaction_mutation\(\)/i, 'Synced transaction writes must be guarded by the correction-aware trigger')
const source = fs.readFileSync('lib/trade-correction-validation.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 } }).outputText
const { parseTradeCorrection } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const valid = { transaction_id: 'a1350000-0000-4000-8000-000000000001', shares: '1.123456', price: '10.123456', fee: '0.000001', reason: 'Correct synthetic fill', expected_revision: 0 }
const parsed = parseTradeCorrection(valid)
assert.equal(parsed.shares, '1.123456'); assert.equal(parsed.price, '10.123456'); assert.equal(parsed.fee, '0.000001')
assert.equal(parseTradeCorrection({ ...valid, fee: '' }).fee, '0')
assert.equal(parseTradeCorrection({ ...valid, price: '1000000000000.123456' }).price, '1000000000000.123456', 'Do not round decimal money through a JS float before the numeric RPC')
assert.equal(parseTradeCorrection({ ...valid, shares: '999999999.999999', price: '9999999999999.999999' }).price, '9999999999999.999999')
assert.equal(parseTradeCorrection({ ...valid, shares: '0001.120000' }).shares, '1.12')
assert.throws(() => parseTradeCorrection({ ...valid, shares: '1000000000' }))
assert.throws(() => parseTradeCorrection({ ...valid, price: '10000000000000' }))
for (const patch of [
  { transaction_id: 'bad' }, { shares: 0 }, { shares: -1 }, { shares: 1.0000001 }, { shares: 1e10 },
  { price: 0 }, { price: Infinity }, { price: '' }, { price: '1000000000.1234567' }, { fee: -1 }, { fee: 0.0000001 },
  { reason: '' }, { reason: 'short' }, { reason: 'x'.repeat(501) },
  { expected_revision: -1 }, { expected_revision: 0.5 }, { expected_revision: '0' },
  { user_id: 'foreign' }, { symbol: 'OTHER' }, { transaction_type: 'SELL' }, { trade_date: '2020-01-01' },
]) assert.throws(() => parseTradeCorrection({ ...valid, ...patch }), /./)
for (const value of [null, [], 'bad']) assert.throws(() => parseTradeCorrection(value), /./)
console.log('✓ Atomic trade correction validation: positive precision and 26 rejection controls passed')
