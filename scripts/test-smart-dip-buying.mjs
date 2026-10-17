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

const engine = fs.existsSync('lib/smart-dip-buying.ts')
  ? await importTsModule('lib/smart-dip-buying.ts')
  : {}
const simulator = await importTsModule('lib/tranche-simulator.ts')
assert.equal(typeof engine.calculateSmartDipPlan, 'function', 'Smart Dip must expose a pure deterministic calculation engine')
assert.equal(typeof engine.parseSmartDipParameters, 'function', 'Smart Dip inputs must have strict server-side validation')

const now = Date.parse('2026-10-18T03:00:00.000Z')
const portfolioA = '11111111-1111-4111-8111-111111111111'
const portfolioB = '22222222-2222-4222-8222-222222222222'
const fresh = { source: 'Finnhub', providerTimestamp: new Date(now - 60_000).toISOString() }
const fixture = (overrides = {}) => ({
  requestedPortfolioId: portfolioA,
  portfolioId: portfolioA,
  allowedSymbols: ['AAA', 'BBB'],
  symbol: 'AAA',
  currency: 'USD',
  quote: { ...fresh, price: 102, currency: 'USD' },
  support: { support: 100, importantSupport: 100, source: 'Yahoo Finance', lastBarAt: new Date(now - 60_000).toISOString() },
  positions: [
    { symbol: 'AAA', shares: 1, observation: { ...fresh, price: 102, currency: 'USD' } },
    { symbol: 'BBB', shares: 2, observation: { ...fresh, price: 50, currency: 'USD' } },
  ],
  dimeBalance: 1_000,
  targets: [{ asset_key: 'AAA', target_pct: 30 }, { asset_key: 'BBB', target_pct: 20 }, { asset_key: 'DIME', target_pct: 50 }],
  params: { budget: 100, cashReserve: 0, maxPositionPct: 30, feePerOrder: 1, trancheCount: 2 },
  nowMs: now,
  ...overrides,
})

const ready = engine.calculateSmartDipPlan(fixture(), simulator.simulateTranches)
assert.equal(ready.decision, 'REVIEW_DIP', 'price within the verified support zone should qualify for review')
assert.ok(ready.reasons.some(reason => reason.code === 'IN_DIP_ZONE'))
assert.equal(ready.scenario?.tranches.length, 2)
assert.equal(ready.scenario?.totalFees, 2)
assert.equal(ready.scenario?.currency, 'USD')
assert.ok(ready.scenario.totalPlannedPurchaseAmount + ready.scenario.totalFees <= ready.confirmedSpendableDime - ready.effectiveReserve + 1e-8)
assert.ok(ready.scenario.projectedPositionWeightPct <= 30)
assert.ok(ready.scenario.remainingDime >= ready.scenario.effectiveReserve, 'planned spend must preserve the full effective reserve')
assert.ok(ready.scenario.remainingDime >= 0, 'remaining DIME must never be negative')
assert.equal(ready.sideEffects, 'READ_ONLY')
assert.ok(ready.scenario.tranches.every(leg => Number.isInteger(Math.round(leg.estimatedShares * 1_000_000)) && leg.estimatedPurchaseAmount <= leg.budget))

const three = engine.calculateSmartDipPlan(fixture({ params: { budget: 90, cashReserve: 0, maxPositionPct: 30, feePerOrder: 1, trancheCount: 3 } }), simulator.simulateTranches)
assert.equal(three.scenario?.tranches.length, 3)
assert.ok(Math.round((three.scenario.totalPlannedPurchaseAmount + three.scenario.totalFees) * 100) <= 9_000)

const one = engine.calculateSmartDipPlan(fixture({ params: { budget: 90, cashReserve: 0, maxPositionPct: 30, feePerOrder: 1, trancheCount: 1 } }), simulator.simulateTranches)
assert.equal(one.scenario?.tranches.length, 1)

const stale = engine.calculateSmartDipPlan(fixture({ quote: { price: 102, currency: 'USD', source: 'Finnhub', providerTimestamp: new Date(now - 24 * 60 * 60 * 1000 - 1).toISOString() } }), simulator.simulateTranches)
assert.equal(stale.decision, 'BLOCKED')
assert.ok(stale.reasons.some(reason => reason.code === 'STALE_QUOTE'))

const missingTimestamp = engine.calculateSmartDipPlan(fixture({ quote: { price: 102, currency: 'USD', source: 'Finnhub', providerTimestamp: null } }), simulator.simulateTranches)
assert.equal(missingTimestamp.decision, 'BLOCKED')
assert.ok(missingTimestamp.reasons.some(reason => reason.code === 'QUOTE_TIMESTAMP_MISSING'))

const future = engine.calculateSmartDipPlan(fixture({ quote: { ...fresh, price: 102, currency: 'USD', providerTimestamp: new Date(now + 6 * 60_000).toISOString() } }), simulator.simulateTranches)
assert.equal(future.decision, 'BLOCKED')

const missingQuote = engine.calculateSmartDipPlan(fixture({ quote: { ...fresh, price: null, currency: 'USD' } }), simulator.simulateTranches)
assert.equal(missingQuote.decision, 'BLOCKED')

const aboveZone = engine.calculateSmartDipPlan(fixture({ quote: { ...fresh, price: 104, currency: 'USD' } }), simulator.simulateTranches)
assert.equal(aboveZone.decision, 'WAIT')

const brokenSupport = engine.calculateSmartDipPlan(fixture({ quote: { ...fresh, price: 99, currency: 'USD' } }), simulator.simulateTranches)
assert.equal(brokenSupport.decision, 'WAIT', 'broken support must not be treated as a buying opportunity')
assert.equal(brokenSupport.scenario, null)

for (const input of [
  fixture({ requestedPortfolioId: portfolioB }),
  fixture({ allowedSymbols: ['BBB'] }),
  fixture({ dimeBalance: null }),
  fixture({ dimeBalance: Number.NaN }),
  fixture({ positions: [{ symbol: 'AAA', shares: 1, observation: { ...fresh, price: null, currency: 'USD' } }, { symbol: 'BBB', shares: 2, observation: { ...fresh, price: 50, currency: 'USD' } }] }),
  fixture({ targets: [{ asset_key: 'AAA', target_pct: 30 }, { asset_key: 'DIME', target_pct: 60 }] }),
  fixture({ quote: { ...fresh, price: 102, currency: 'EUR' } }),
  fixture({ support: { support: null, importantSupport: null, source: null, lastBarAt: null } }),
  fixture({ positions: [
    { symbol: 'AAA', shares: 1, observation: { ...fresh, price: 102, currency: 'USD' } },
    { symbol: 'AAA', shares: 1, observation: { ...fresh, price: 102, currency: 'USD' } },
  ] }),
]) {
  assert.equal(engine.calculateSmartDipPlan(input, simulator.simulateTranches).decision, 'BLOCKED')
}

const parserInput = { portfolio_id: portfolioA, symbol: 'AAA', budget: 100, cash_reserve: 0, max_position_pct: 30, fee_per_order: 1, tranche_count: 2 }
const invalidBudget = { ...parserInput, budget: -1 }
assert.throws(() => engine.parseSmartDipParameters(invalidBudget))
assert.throws(() => engine.parseSmartDipParameters({ ...parserInput, tranche_count: 4 }))
assert.throws(() => engine.parseSmartDipParameters({ ...parserInput, fee_per_order: 0.001 }))

const tooLittleCash = engine.calculateSmartDipPlan(fixture({ dimeBalance: 2, positions: [
  { symbol: 'AAA', shares: 0, observation: { ...fresh, price: 102, currency: 'USD' } },
  { symbol: 'BBB', shares: 2, observation: { ...fresh, price: 50, currency: 'USD' } },
], params: { budget: 100, cashReserve: 1, maxPositionPct: 30, feePerOrder: 1, trancheCount: 2 } }), simulator.simulateTranches)
assert.equal(tooLittleCash.decision, 'BLOCKED')
assert.ok(tooLittleCash.reasons.some(reason => reason.code === 'INSUFFICIENT_RESERVE_ADJUSTED_BUDGET'))

const overweight = engine.calculateSmartDipPlan(fixture({ positions: [
  { symbol: 'AAA', shares: 20, observation: { ...fresh, price: 102, currency: 'USD' } },
  { symbol: 'BBB', shares: 2, observation: { ...fresh, price: 50, currency: 'USD' } },
] }), simulator.simulateTranches)
assert.ok(['WAIT', 'BLOCKED'].includes(overweight.decision))
assert.equal(overweight.scenario, null)

const allocationOverrun = engine.calculateSmartDipPlan(fixture({ params: { budget: 600, cashReserve: 0, maxPositionPct: 30, feePerOrder: 0, trancheCount: 1 } }), simulator.simulateTranches)
assert.equal(allocationOverrun.scenario, null)
assert.ok(allocationOverrun.reasons.some(reason => reason.code === 'POSITION_CAP_EXCEEDED'))

const duplicateOrInvalidTargets = engine.calculateSmartDipPlan(fixture({ targets: [{ asset_key: 'AAA', target_pct: 50 }, { asset_key: 'AAA', target_pct: 50 }] }), simulator.simulateTranches)
assert.equal(duplicateOrInvalidTargets.decision, 'BLOCKED')

const missingCashEvidence = engine.calculateSmartDipPlan(fixture({ dimeBalance: null }), simulator.simulateTranches)
assert.equal(missingCashEvidence.decision, 'BLOCKED')
assert.ok(missingCashEvidence.reasons.some(reason => reason.code === 'DIME_UNAVAILABLE'))

const feeExceedsBudget = engine.calculateSmartDipPlan(fixture({ params: { budget: 2, cashReserve: 0, maxPositionPct: 30, feePerOrder: 1, trancheCount: 3 } }), simulator.simulateTranches)
assert.equal(feeExceedsBudget.decision, 'BLOCKED')
assert.ok(feeExceedsBudget.reasons.some(reason => reason.code === 'INSUFFICIENT_RESERVE_ADJUSTED_BUDGET'))

const unverifiedCurrency = engine.calculateSmartDipPlan(fixture({ currency: null }), simulator.simulateTranches)
assert.equal(unverifiedCurrency.decision, 'BLOCKED')
assert.ok(unverifiedCurrency.reasons.some(reason => reason.code === 'CURRENCY_UNVERIFIED'))

const badPositionCurrency = engine.calculateSmartDipPlan(fixture({ positions: [
  { symbol: 'AAA', shares: 1, observation: { ...fresh, price: 102, currency: 'USD' } },
  { symbol: 'BBB', shares: 2, observation: { ...fresh, price: 50, currency: 'EUR' } },
] }), simulator.simulateTranches)
assert.equal(badPositionCurrency.decision, 'BLOCKED')

const staleSupport = engine.calculateSmartDipPlan(fixture({ support: { support: 100, importantSupport: 100, source: 'Yahoo Finance', lastBarAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() } }), simulator.simulateTranches)
assert.equal(staleSupport.decision, 'BLOCKED')
assert.ok(staleSupport.reasons.some(reason => reason.code === 'STALE_SUPPORT'))

const futureSupport = engine.calculateSmartDipPlan(fixture({ support: { support: 100, importantSupport: 100, source: 'Yahoo Finance', lastBarAt: new Date(now + 6 * 60_000).toISOString() } }), simulator.simulateTranches)
assert.equal(futureSupport.decision, 'BLOCKED')
assert.ok(futureSupport.reasons.some(reason => reason.code === 'STALE_SUPPORT'))

const reserveAboveDime = engine.calculateSmartDipPlan(fixture({ params: { budget: 100, cashReserve: 2_000, maxPositionPct: 30, feePerOrder: 0, trancheCount: 1 } }), simulator.simulateTranches)
assert.equal(reserveAboveDime.decision, 'BLOCKED')
assert.equal(reserveAboveDime.spendableDime, 0, 'reserve above confirmed DIME must not display negative spendable cash')

const unpricedRisk = engine.calculateSmartDipPlan(fixture({ stopLoss: null }), simulator.simulateTranches)
assert.equal(unpricedRisk.scenario?.stopRiskAmount, null)
assert.equal(unpricedRisk.scenario?.stopRiskAvailability, 'UNAVAILABLE')

const params = engine.parseSmartDipParameters({ symbol: 'aaa', portfolio_id: portfolioA, budget: '100.25', cash_reserve: '20', max_position_pct: '20', fee_per_order: '1.25', tranche_count: 3 })
assert.equal(params.symbol, 'AAA')
assert.equal(params.budget, 100.25)
assert.throws(() => engine.parseSmartDipParameters({ symbol: 'AAA;DROP', portfolio_id: portfolioA, budget: 1, cash_reserve: 0, max_position_pct: 20, fee_per_order: 0, tranche_count: 1 }))
assert.throws(() => engine.parseSmartDipParameters({ symbol: 'AAA', portfolio_id: portfolioA, budget: Number.NaN, cash_reserve: 0, max_position_pct: 20, fee_per_order: 0, tranche_count: 1 }))
assert.throws(() => engine.parseSmartDipParameters({ symbol: 'AAA', portfolio_id: portfolioA, budget: 1, cash_reserve: 0, max_position_pct: 31, fee_per_order: 0, tranche_count: 1 }))

const stalePortfolio = engine.calculateSmartDipPlan(fixture({ portfolioId: portfolioB }), simulator.simulateTranches)
assert.equal(stalePortfolio.decision, 'BLOCKED')
assert.ok(stalePortfolio.reasons.some(reason => reason.code === 'PORTFOLIO_MISMATCH'))

const ineligibleSymbol = engine.calculateSmartDipPlan(fixture({ allowedSymbols: ['BBB'] }), simulator.simulateTranches)
assert.equal(ineligibleSymbol.decision, 'BLOCKED')
assert.ok(ineligibleSymbol.reasons.some(reason => reason.code === 'SYMBOL_NOT_ELIGIBLE'))

const api = fs.readFileSync('app/api/smart-dip/route.ts', 'utf8')
assert.match(api, /requirePhaseAPortfolio/, 'API must enforce real Auth, PIN, and selected portfolio')
assert.match(api, /Cache-Control.*no-store/, 'Sensitive response must not be cached')
assert.match(api, /request\.headers\.get\('origin'\)/, 'Calculation POST must check same-origin')
assert.match(api, /origin !== new URL\(request\.url\)\.origin/, 'Missing Origin must not bypass same-origin enforcement')
assert.match(api, /getQuoteObservations/, 'Only timestamped quote observations may feed the decision engine')
assert.match(api, /getCompanyProfileResults/, 'Currency must be verified instead of assumed from symbol')
assert.match(api, /getSupportResistanceLadder/, 'Support must reuse the existing bounded indicator adapter')
assert.match(api, /get_decrypted_trade_plans|stop_loss/, 'Existing Trade Plan stop context must be respected when available')
assert.doesNotMatch(api, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(['"](?:buy|sell|execute|place)/i, 'Smart Dip API must not write or execute trades')
const getHandler = api.slice(api.indexOf('export async function GET'), api.indexOf('export async function POST'))
assert.doesNotMatch(getHandler, /getQuoteObservations|getCompanyProfileResults|getSupportResistanceLadder/, 'Candidate loading must not cause provider traffic automatically')
assert.match(api, /symbols\.length > MAX_SYMBOLS/, 'Provider requests must remain bounded to the declared symbol universe')
assert.ok(api.indexOf('Target Allocation ยังไม่ครบ') < api.indexOf('getQuoteObservations(symbols)'), 'invalid allocation evidence must stop before providers run')
assert.ok(api.indexOf('provider requests ถูกข้าม') < api.indexOf('getQuoteObservations(symbols)'), 'missing DIME must stop before providers run')
assert.equal((api.match(/\.eq\('user_id', (?:userId|context\.userId)\)/g) ?? []).length >= 4, true, 'Each portfolio data query must include authenticated user scope')
assert.equal((api.match(/\.eq\('portfolio_id', (?:portfolioId|context\.portfolioId)\)/g) ?? []).length >= 4, true, 'Each portfolio data query must include selected portfolio scope')

const ui = fs.readFileSync('components/portfolio/SmartDipBuying.tsx', 'utf8')
const engineSource = fs.readFileSync('lib/smart-dip-buying.ts', 'utf8')
assert.match(ui, /ไม่มีการส่งคำสั่งซื้อหรือแก้ Holdings อัตโนมัติ/)
assert.match(ui, /aria-label=|<label/)
assert.match(ui, /Loading|กำลังโหลด|กำลังคำนวณ/)
assert.match(ui, /Unavailable|ไม่พร้อม|ยังไม่พร้อม/)
assert.match(ui, /tranche_count/)
assert.match(ui, /requestSequence/, 'A late response must not replace a newer calculation')
assert.match(ui, /candidateState\.portfolio\.id/, 'Calculation request must be bound to the portfolio returned by authenticated context')
assert.match(ui, /\.abort\(\)/, 'Unmounted or superseded requests must be cancelled client-side')
assert.match(ui, /Promise\.resolve\(\)\.then/, 'Initial candidate loading must remain asynchronous from the effect')
assert.match(engineSource, /fundamentalsStatus: 'NOT_INCLUDED'/, 'Missing fundamentals must stay explicitly unavailable instead of inferred')

console.log('✓ Smart Dip decision, finance invariants, input validation, API security, and UI contracts passed')
