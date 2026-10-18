import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

async function importTsModule(filePath, transform = source => source) {
  const source = transform(fs.readFileSync(filePath, 'utf8'))
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
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

const perf = await importTsModule('lib/performance.ts')
globalThis.__testPerformance = perf
globalThis.__testYahoo = { chart: undefined }
const historyModule = await importTsModule('lib/performance-history.ts', source => source
  .replace(/import YahooFinance from 'yahoo-finance2'\r?\n/, '')
  .replace(/import \{[\s\S]*?\} from '@\/lib\/performance'\r?\n/, 'const { buildPerformanceCurve } = globalThis.__testPerformance\n')
  .replace('const yahooFinance = new YahooFinance()', 'const yahooFinance = globalThis.__testYahoo'))

const baseTransactions = [
  { id: '1', transaction_type: 'OPENING_POSITION', symbol: 'NVDA', shares: 10, price: 100, fee: null, amount: null, trade_date: '2026-01-02' },
  { id: '2', transaction_type: 'SELL', symbol: 'NVDA', shares: 4, price: 120, fee: 0, amount: null, trade_date: '2026-02-02' },
  { id: '3', transaction_type: 'DIVIDEND', symbol: 'NVDA', shares: null, price: null, fee: null, amount: 5, trade_date: '2026-02-10' },
]

const result = perf.calculatePerformance(baseTransactions, [
  { symbol: 'NVDA', shares: 6, cost_basis: 100, current_price: 130 },
])
assert.equal(result.summary.realized_pnl, 80)
assert.equal(result.summary.unrealized_pnl, 180)
assert.equal(result.summary.dividends, 5)
assert.equal(result.summary.total_pnl, 265)
assert.equal(result.summary.win_rate_pct, 100)
assert.equal(result.summary.ledger_complete, true)
assert.equal(result.by_symbol[0].is_match, true)

const fifo = perf.calculatePerformance([
  { id: 'a', transaction_type: 'OPENING_POSITION', symbol: 'AMD', shares: 2, price: 100, fee: null, amount: null, trade_date: '2026-01-01' },
  { id: 'b', transaction_type: 'BUY', symbol: 'AMD', shares: 2, price: 200, fee: 0, amount: null, trade_date: '2026-01-02' },
  { id: 'c', transaction_type: 'SELL', symbol: 'AMD', shares: 3, price: 150, fee: 0, amount: null, trade_date: '2026-01-03' },
], [{ symbol: 'AMD', shares: 1, cost_basis: 200, current_price: 210 }])
assert.equal(fifo.summary.realized_pnl, 50, 'Realized P/L must use FIFO lots')
assert.equal(fifo.closed_trades[0].cost, 400)

const oversell = perf.calculatePerformance([
  { id: 'o1', transaction_type: 'OPENING_POSITION', symbol: 'MSFT', shares: 2, price: 100, fee: null, amount: null, trade_date: '2026-01-01' },
  { id: 'o2', transaction_type: 'SELL', symbol: 'MSFT', shares: 3, price: 150, fee: 0, amount: null, trade_date: '2026-01-02' },
  { id: 'o3', transaction_type: 'SELL', symbol: 'MSFT', shares: 1, price: 160, fee: 0, amount: null, trade_date: '2026-01-03' },
], [{ symbol: 'MSFT', shares: 1, cost_basis: 100, current_price: 170 }])
assert.equal(oversell.summary.realized_pnl, 60, 'Rejected over-sell must not consume FIFO lots needed by later valid sells')
assert.equal(oversell.summary.net_sells, 160, 'Rejected over-sell must not inflate aggregate sell proceeds')
assert.equal(oversell.closed_trades.length, 1)
assert.equal(oversell.closed_trades[0].shares, 1)
assert.equal(oversell.by_symbol[0].ledger_shares, 1)
assert.equal(oversell.by_symbol[0].is_match, true)
assert.equal(oversell.summary.ledger_complete, false, 'Rejected over-sell must still mark the ledger incomplete')
assert.match(oversell.summary.warnings.join('\n'), /ขายมากกว่าจำนวนหุ้นใน Ledger/)

const mismatch = perf.calculatePerformance(baseTransactions, [
  { symbol: 'NVDA', shares: 7, cost_basis: 100, current_price: 130 },
])
assert.equal(mismatch.summary.ledger_complete, false)
assert.match(mismatch.summary.warnings.join('\n'), /Ledger 6 หุ้น แต่ Holdings 7 หุ้น/)

const curve = perf.buildPerformanceCurve(
  [{ id: 'x', transaction_type: 'OPENING_POSITION', symbol: 'AAPL', shares: 1, price: 100, fee: null, amount: null, trade_date: '2026-01-01' }],
  { AAPL: [{ date: '2026-01-01', close: 100 }, { date: '2026-01-02', close: 110 }] },
  ['2026-01-01', '2026-01-02'],
)
assert.equal(curve.length, 2)
assert.equal(curve[0].pnl, 0)
assert.equal(curve[1].pnl, 10)
assert.equal(curve[1].return_on_gross_invested_pct, 10)

for (const path of [
  'app/api/performance/route.ts',
  'app/performance/page.tsx',
  'app/performance/error.tsx',
  'components/portfolio/PerformanceDashboard.tsx',
  'lib/performance.ts',
  'lib/performance-history.ts',
]) assert.equal(fs.existsSync(path), true, `${path} is required`)

const historyTransactions = Array.from({ length: 14 }, (_, index) => ({
  id: `h${index}`, transaction_type: 'BUY', symbol: `S${String(index).padStart(2, '0')}`,
  shares: 1, price: 10, fee: 0, amount: null, trade_date: '2026-01-01',
}))
let activeHistoryRequests = 0
let maximumHistoryConcurrency = 0
const historyCalls = []
globalThis.__testYahoo.chart = async (symbol, _options, moduleOptions) => {
    historyCalls.push(symbol)
    activeHistoryRequests += 1
    maximumHistoryConcurrency = Math.max(maximumHistoryConcurrency, activeHistoryRequests)
    try {
      assert.ok(moduleOptions?.fetchOptions?.signal instanceof AbortSignal, 'Yahoo chart must receive a cancellable signal')
      await new Promise(resolve => setTimeout(resolve, 5))
      return { quotes: [{ date: new Date('2026-01-01T00:00:00Z'), close: 10 }, { date: new Date('2026-01-02T00:00:00Z'), close: 11 }] }
    } finally {
      activeHistoryRequests -= 1
    }
  }
const boundedHistory = await historyModule.getPerformanceHistory(historyTransactions)
assert.ok(historyCalls.length <= 12, 'Performance history must cap all Yahoo requests, including SPY, at 12')
assert.ok(maximumHistoryConcurrency <= 2, 'Performance history Yahoo concurrency must not exceed two')
assert.equal(boundedHistory.complete, false, 'Capped symbols must mark historical coverage incomplete')
assert.deepEqual(boundedHistory.points, [], 'Incomplete price coverage must not produce a complete-looking curve')
assert.ok(boundedHistory.missing_symbols.length > 0)
assert.equal(maximumHistoryConcurrency, 2, 'the history loader should use its bounded parallelism for independent symbols')

const normalHistory = await historyModule.getPerformanceHistory(historyTransactions.slice(0, 1))
assert.equal(normalHistory.complete, true)
assert.equal(normalHistory.points.length, 2)
globalThis.__testYahoo.chart = async symbol => symbol === 'SPY'
  ? { quotes: [] }
  : { quotes: [{ date: new Date('2026-01-01T00:00:00Z'), close: 10 }, { date: new Date('2026-01-02T00:00:00Z'), close: 11 }] }
const benchmarkFailure = await historyModule.getPerformanceHistory(historyTransactions.slice(0, 1))
assert.equal(benchmarkFailure.complete, false, 'an unavailable SPY benchmark is not presented as complete history')
assert.deepEqual(benchmarkFailure.points, [])
assert.ok(benchmarkFailure.missing_symbols.includes('SPY'))
const emptyHistory = await historyModule.getPerformanceHistory([])
assert.equal(emptyHistory.complete, true)
assert.deepEqual(emptyHistory.points, [])

const timedOutSymbols = []
globalThis.__testYahoo.chart = async (symbol, _options, moduleOptions) => {
  timedOutSymbols.push(symbol)
  const signal = moduleOptions.fetchOptions.signal
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('aborted'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
const originalConsoleError = console.error
console.error = () => {}
const timeoutStartedAt = Date.now()
const timedOutHistory = await historyModule.getPerformanceHistory(historyTransactions.slice(0, 1))
console.error = originalConsoleError
assert.ok(Date.now() - timeoutStartedAt >= 7_500 && Date.now() - timeoutStartedAt < 10_000, 'history deadline is enforced near eight seconds')
assert.equal(timedOutHistory.complete, false)
assert.deepEqual(timedOutHistory.points, [])
assert.deepEqual(new Set(timedOutHistory.missing_symbols), new Set(['S00', 'SPY']))
assert.equal(timedOutSymbols.length, 2)

const api = fs.readFileSync('app/api/performance/route.ts', 'utf8')
assert.match(api, /get_decrypted_portfolio_transactions/, 'Performance must read the encrypted Transaction Ledger server-side')
assert.match(api, /get_decrypted_holdings/, 'Performance must compare against current Holdings')
assert.match(api, /calculatePerformance/, 'Performance API must use the deterministic engine')
assert.match(api, /getPerformanceHistory/, 'Performance API must load isolated historical market data')
assert.doesNotMatch(api, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/, 'Performance API must remain read-only')

const history = fs.readFileSync('lib/performance-history.ts', 'utf8')
assert.match(history, /yahoo-finance2/, 'Historical performance must use the existing Yahoo Finance dependency')
assert.match(history, /MAX_HISTORY_YEARS = 5/, 'Historical requests need a bounded lookback')
assert.match(history, /SPY/, 'Performance must include the SPY reference benchmark')
assert.match(history, /MAX_HISTORY_SYMBOLS\s*=\s*12/)
assert.match(history, /MAX_HISTORY_CONCURRENCY\s*=\s*2/)
assert.match(history, /HISTORY_DEADLINE_MS\s*=\s*8_000/)
assert.match(api, /getPerformanceHistory\(transactions, request\.signal\)/, 'client cancellation must reach the history adapter')

const ui = fs.readFileSync('components/portfolio/PerformanceDashboard.tsx', 'utf8')
assert.match(ui, /กำไร\/ขาดทุนที่รับรู้/, 'UI must expose realized P/L')
assert.match(ui, /กำไร\/ขาดทุนที่ยังไม่รับรู้/, 'UI must expose unrealized P/L')
assert.match(ui, /Win Rate/, 'UI must expose trade win rate')
assert.match(ui, /กราฟ P\/L สะสม/, 'UI must expose a performance curve')
assert.match(ui, /ดีลดีที่สุด/, 'UI must expose best trade')
assert.match(ui, /ดีลแย่ที่สุด/, 'UI must expose worst trade')
assert.match(ui, /Transaction Ledger ยังไม่แก้ Holdings อัตโนมัติ/, 'UI must preserve the no-auto-sync safety boundary')

const nav = fs.readFileSync('components/navigation/AppTabs.tsx', 'utf8')
assert.match(nav, /href: '\/performance'/, 'Performance must be a main navigation tab')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
assert.match(pkg.scripts['test:critical'], /test-performance\.mjs/, 'Performance regression test must be part of the critical build gate')

console.log('✓ Performance regression tests passed')
