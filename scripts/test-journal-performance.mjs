import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

async function importTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${filePath}: ${errors.map(item => item.messageText).join('; ')}`)
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
}

const stats = await importTsModule('lib/trade-statistics.ts')
const fx = await importTsModule('lib/fx-attribution.ts')

const tradeGroups = [
  { symbol: 'ABC', trade_date: '2026-01-03', shares: 1, proceeds: 150, cost: 100, pnl: 50, pnl_pct: 50 },
  { symbol: 'ABC', trade_date: '2026-01-04', shares: 1, proceeds: 90, cost: 100, pnl: -10, pnl_pct: -10 },
  { symbol: 'XYZ', trade_date: '2026-01-05', shares: 2, proceeds: 200, cost: 200, pnl: 0, pnl_pct: 0 },
]
const summary = stats.summarizeTradeStatistics(tradeGroups)
assert.deepEqual(summary, {
  closedTrades: 3,
  winningTrades: 1,
  losingTrades: 1,
  breakevenTrades: 1,
  winRatePct: 33.33,
  averageWin: 50,
  averageLoss: -10,
  profitFactor: 5,
  expectancy: 13.33,
  grossWins: 50,
  grossLosses: 10,
  realizedPnl: 40,
  totalRecordedFees: 0,
})

const allWins = stats.summarizeTradeStatistics([tradeGroups[0]])
assert.equal(allWins.profitFactor, null, 'Profit factor is unavailable without a loss denominator')
assert.equal(allWins.averageLoss, null)
assert.equal(allWins.expectancy, 50)
const openOnly = stats.summarizeTradeStatistics([])
assert.equal(openOnly.winRatePct, null)
assert.equal(openOnly.expectancy, null)
assert.equal(openOnly.closedTrades, 0)
assert.equal(stats.summarizeTradeStatistics([{ ...tradeGroups[0], pnl: Number.NaN }]).closedTrades, 0)

const attributed = fx.attributeFxProfit({
  quantity: 2,
  acquisitionPrice: 10,
  disposalPrice: 12,
  acquisitionFee: 1,
  disposalFee: 0.5,
  acquisitionFx: 1.2,
  disposalFx: 1.3,
  sourceCurrency: 'EUR',
  reportingCurrency: 'USD',
  source: 'synthetic verified fixture',
  sourceRetrievedAt: '2026-02-01T15:00:00.000Z',
  acquisitionRateDate: '2026-01-01',
  disposalRateDate: '2026-02-01',
})
assert.equal(attributed.status, 'available')
assert.equal(attributed.securityPnl, 3)
assert.equal(attributed.fxPnl, 2.35)
assert.equal(attributed.totalPnl, 5.35)
assert.equal(attributed.reconciliationDelta, 0)
const fxInput = {
  quantity: 2,
  acquisitionPrice: 10,
  disposalPrice: 12,
  acquisitionFee: 1,
  disposalFee: 0.5,
  acquisitionFx: 1.2,
  disposalFx: 1.3,
  sourceCurrency: 'EUR',
  reportingCurrency: 'USD',
  source: 'synthetic verified fixture',
  sourceRetrievedAt: '2026-02-01T15:00:00.000Z',
  acquisitionRateDate: '2026-01-01',
  disposalRateDate: '2026-02-01',
}
assert.equal(fx.attributeFxProfit({ ...fxInput, acquisitionFx: 0 }).status, 'unavailable')
assert.equal(fx.attributeFxProfit({ ...fxInput, source: '' }).status, 'unavailable')
assert.equal(fx.attributeFxProfit({ ...fxInput, acquisitionRateDate: '' }).status, 'unavailable')
assert.equal(fx.attributeFxProfit({ ...fxInput, sourceCurrency: 'USD' }).status, 'unavailable')
assert.equal(fx.attributeFxProfit({ ...fxInput, sourceRetrievedAt: 'not-a-date' }).status, 'unavailable')

const performance = await importTsModule('lib/performance.ts')
const partialSales = performance.calculatePerformance([
  { id: 'buy-1', transaction_type: 'BUY', symbol: 'ABC', shares: 5, price: 10, fee: 1, amount: null, trade_date: '2026-01-01' },
  { id: 'buy-2', transaction_type: 'BUY', symbol: 'ABC', shares: 5, price: 12, fee: 2, amount: null, trade_date: '2026-01-02' },
  { id: 'sell-1', transaction_type: 'SELL', symbol: 'ABC', shares: 6, price: 15, fee: 3, amount: null, trade_date: '2026-01-03' },
  { id: 'sell-2', transaction_type: 'SELL', symbol: 'ABC', shares: 2, price: 13, fee: 1, amount: null, trade_date: '2026-01-04' },
], [{ symbol: 'ABC', shares: 2, cost_basis: null, current_price: 14 }])
assert.equal(partialSales.closed_trades.length, 2, 'Each accepted SELL is one trade group, even when FIFO consumes multiple lots')
assert.equal(partialSales.summary.realized_pnl, 23.8)
assert.equal(partialSales.summary.ledger_complete, true)
assert.equal(partialSales.summary.unrealized_pnl, 3.2)
const partialStatistics = stats.summarizeTradeStatistics(partialSales.closed_trades, 7)
assert.equal(partialStatistics.closedTrades, 2)
assert.equal(partialStatistics.realizedPnl, partialSales.summary.realized_pnl, 'Trade statistics must reconcile to FIFO realized P/L')
assert.equal(partialStatistics.totalRecordedFees, 7)

const rejectedOversell = performance.calculatePerformance([
  { id: 'open', transaction_type: 'OPENING_POSITION', symbol: 'XYZ', shares: 1, price: 20, fee: null, amount: null, trade_date: '2026-01-01' },
  { id: 'oversell', transaction_type: 'SELL', symbol: 'XYZ', shares: 2, price: 30, fee: 1, amount: null, trade_date: '2026-01-02' },
], [{ symbol: 'XYZ', shares: 1, cost_basis: 20, current_price: null }])
assert.equal(rejectedOversell.closed_trades.length, 0)
assert.equal(stats.summarizeTradeStatistics(rejectedOversell.closed_trades).closedTrades, 0)
assert.equal(rejectedOversell.summary.ledger_complete, false)

const journal = fs.readFileSync('components/portfolio/TradingJournal.tsx', 'utf8')
assert.ok(journal.includes('เหตุผลการเข้าเทรด'))
assert.ok(journal.includes('แผนการเทรด'))
assert.ok(journal.includes('ทบทวนการดำเนินการ'))
assert.ok(journal.includes('บทเรียนที่ได้รับ'))
assert.match(journal, /draft-only|แบบร่างในหน่วยความจำ/i)
assert.doesNotMatch(journal, /localStorage|sessionStorage|indexedDB/)
assert.doesNotMatch(journal, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]|\.insert\(|\.upsert\(/)
assert.ok(journal.includes('beforeunload'))
assert.ok(journal.includes('popstate'))
assert.ok(journal.includes('confirmBeforePortfolioSwitch'))
assert.ok(journal.includes('stopImmediatePropagation'))

const transactionsApi = fs.readFileSync('app/api/transactions/route.ts', 'utf8')
assert.match(transactionsApi, /portfolio:\s*portfolio\.mode === 'portfolio'/)
assert.match(transactionsApi, /p_portfolio_id:\s*portfolio\.portfolioId/)
assert.match(transactionsApi, /p_user_id:\s*user\.id/)
const transactionsPage = fs.readFileSync('app/transactions/page.tsx', 'utf8')
assert.ok(transactionsPage.includes('<InactivityPinLock />'))
assert.ok(transactionsPage.includes('resolveActivePortfolio'))
const journalUi = fs.readFileSync('components/portfolio/TradingJournal.tsx', 'utf8')
assert.match(journalUi, /expectedPortfolioId/)
assert.ok(journalUi.includes('body.portfolio?.id'))
assert.ok(journalUi.includes('ข้อมูล Ledger ที่ได้รับไม่ครบ'))
assert.doesNotMatch(journalUi, /dangerouslySetInnerHTML/)

const performanceUi = fs.readFileSync('components/portfolio/PerformanceDashboard.tsx', 'utf8')
assert.ok(performanceUi.includes('Profit Factor'))
assert.ok(performanceUi.includes('Expectancy'))
assert.ok(performanceUi.includes('FX Attribution'))
assert.ok(performanceUi.includes('ยังไม่พร้อมคำนวณ'))
assert.ok(performanceUi.includes('trade_statistics_by_symbol'))
assert.ok(fs.readFileSync('app/api/performance/route.ts', 'utf8').includes('summarizeTradeStatistics'))

const changelog = fs.readFileSync('config/changelog-v1380.ts', 'utf8')
assert.match(changelog, /v1\.38\.0/)
assert.match(changelog, /date: 'Development History — Feature commit 2026-10-18 02:48 ICT \(ไม่ใช่ Production\)'/)
assert.ok(changelog.includes("from './changelog-v1370'"))
assert.match(changelog, /FX Profit Attribution/, 'v1.38.0 development history must be preserved')
const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'))
assert.deepEqual(tsconfig.compilerOptions.paths['@/config/changelog'], ['./config/changelog-v14115'])
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
assert.equal(pkg.version, '1.41.15')
assert.match(pkg.scripts['test:critical'], /test-journal-performance\.mjs/)

console.log('✓ Trading Journal / Statistics / FX regression tests passed')
