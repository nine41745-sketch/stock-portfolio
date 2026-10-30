import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import ts from 'typescript'

function load(file, mocks = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(name => {
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`)
    return mocks[name]
  }, loaded, loaded.exports)
  return loaded.exports
}
const dca = load('lib/smart-dca.ts')
const dividend = load('lib/dividend-intelligence.ts')
const parameters = { budget: 100, cash_reserve: 0, max_position_pct: 30, fee_per_order: 0 }
const positions = [{ symbol: 'AAA', shares: 200, price: 1 }, { symbol: 'BBB', shares: 100, price: 1 }]
const targets = [{ asset_key: 'AAA', target_pct: 40 }, { asset_key: 'BBB', target_pct: 40 }, { asset_key: 'DIME', target_pct: 20 }]

test('DCA spends existing DIME, preserves cash target and does not add budget to total', () => {
  const plan = dca.calculateDcaPlan(positions, targets, 700, parameters)
  assert.equal(plan.status, 'READY')
  assert.equal(plan.portfolio_value, 1000)
  assert.equal(plan.effective_reserve, 200)
  assert.equal(plan.invested, 100)
  assert.equal(plan.remaining_dime, 600)
  assert.deepEqual(plan.rows.map(r => r.amount), [33.33, 66.67])
})
test('DCA enforces cash reserve, fee budget, gaps and concentration after fees', () => {
  const plan = dca.calculateDcaPlan(positions, targets, 700, { ...parameters, budget: 900, cash_reserve: 500, fee_per_order: 2 })
  assert.equal(plan.available_budget, 200)
  assert.ok(plan.invested + plan.fees <= 200)
  assert.ok(plan.remaining_dime >= 500)
  assert.ok(plan.rows.every(r => r.projected_pct <= 30))
  assert.equal(plan.fees, 4)
})
test('DCA fails closed for missing/invalid prices, missing DIME and malformed targets', () => {
  for (const [p, t, cash] of [
    [[{ ...positions[0], price: null }, positions[1]], targets, 700],
    [positions, targets, null], [positions, [], 700],
    [positions, [...targets, targets[0]], 700],
    [[{ ...positions[0], shares: NaN }, positions[1]], targets, 700],
    [positions, [{ asset_key: 'AAA', target_pct: 99 }], 700],
  ]) {
    const result = dca.calculateDcaPlan(p, t, cash, parameters)
    assert.equal(result.status, 'BLOCKED'); assert.equal(result.rows.length, 0)
  }
  const newTarget = [{ asset_key: 'CCC', target_pct: 80 }, { asset_key: 'DIME', target_pct: 20 }]
  assert.equal(dca.calculateDcaPlan(positions, newTarget, 700, parameters).status, 'BLOCKED')
})
test('DCA blocks exhausted cash and overweight-only portfolios; validates input boundaries', () => {
  assert.equal(dca.calculateDcaPlan(positions, targets, 700, { ...parameters, cash_reserve: 700 }).status, 'BLOCKED')
  assert.equal(dca.calculateDcaPlan(positions, targets, 700, { ...parameters, budget: 0 }).status, 'BLOCKED')
  const overweight = [{ symbol: 'AAA', shares: 900, price: 1 }]
  assert.equal(dca.calculateDcaPlan(overweight, [{ asset_key: 'AAA', target_pct: 100 }], 100, parameters).status, 'BLOCKED')
  for (const value of [-1, NaN, Infinity, 0.001, 1_000_000_001]) assert.throws(() => dca.parseDcaParameters({ ...parameters, budget: value }))
  for (const value of [0, 30.1, NaN, true, null]) assert.throws(() => dca.parseDcaParameters({ ...parameters, max_position_pct: value }))
})
test('DCA is order-independent and preserves money bounds across varied fractional prices', () => {
  for (let i = 1; i <= 200; i++) {
    const p = [{ symbol: 'AAA', shares: 0.2, price: 9.17 + i / 3 }, { symbol: 'BBB', shares: 0.4, price: 13.27 + i / 7 }]
    const cash = 100 + i
    const args = { ...parameters, budget: i / 10, fee_per_order: 0.01, cash_reserve: i / 20 }
    const result = dca.calculateDcaPlan(p, targets, cash, args)
    assert.deepEqual(result, dca.calculateDcaPlan([...p].reverse(), [...targets].reverse(), cash, args))
    assert.ok(result.invested + result.fees <= args.budget + 1e-8)
    assert.ok(result.remaining_dime >= args.cash_reserve - 1e-8)
    assert.ok(result.rows.every(r => r.projected_pct <= 30 + 1e-8 && r.amount > 0 && r.shares > 0))
  }
})
const div = (id, symbol, amount, trade_date = '2026-10-01') => ({ id, symbol, amount, trade_date, transaction_type: 'DIVIDEND' })

test('DCA blocks fees pushing an unpurchased holding above cap, including holdings outside targets', () => {
  const ts = [{ asset_key: 'AAA', target_pct: 30 }, { asset_key: 'BBB', target_pct: 30 }, { asset_key: 'CCC', target_pct: 20 }, { asset_key: 'DIME', target_pct: 20 }]
  const ps = [{ symbol: 'AAA', shares: 300, price: 1 }, { symbol: 'BBB', shares: 0, price: 1 }, { symbol: 'CCC', shares: 0, price: 1 }]
  for (const existingSymbol of ['AAA', 'OUTSIDE']) {
    const input = [{ ...ps[0], symbol: existingSymbol }, ...ps.slice(1), ...(existingSymbol === 'OUTSIDE' ? [{ symbol: 'AAA', shares: 0, price: 1 }] : [])]
    const before = structuredClone(input)
    const plan = dca.calculateDcaPlan(input, ts, 700, { ...parameters, fee_per_order: 1 })
    assert.equal(plan.status, 'BLOCKED'); assert.equal(plan.rows.length, 0)
    assert.equal(plan.invested, 0); assert.equal(plan.fees, 0); assert.equal(plan.remaining_dime, 700)
    assert.match(plan.warnings.join(' '), new RegExp(existingSymbol))
    assert.deepEqual(input, before)
    assert.equal(dca.calculateDcaPlan(input, ts, 700, parameters).status, 'READY')
  }
})

test('DCA concentration boundary uses actual fees and all holdings', () => {
  const ts = [{ asset_key: 'BBB', target_pct: 60 }, { asset_key: 'DIME', target_pct: 40 }]
  for (const value of [299.69, 299.70, 299.71]) {
    const ps = [{ symbol: 'EXISTING', shares: value, price: 1 }, { symbol: 'BBB', shares: 0, price: 1 }]
    const cash = 1000 - value
    const plan = dca.calculateDcaPlan(ps, ts, cash, { ...parameters, fee_per_order: 1 })
    assert.equal(plan.status, value > 299.70 ? 'BLOCKED' : 'READY')
    assert.ok(plan.invested + plan.fees <= parameters.budget)
    assert.ok(plan.remaining_dime >= plan.effective_reserve)
    if (plan.status === 'READY') {
      const final = 1000 - plan.fees
      for (const p of ps) {
        const bought = plan.rows.find(r => r.symbol === p.symbol)?.amount ?? 0
        assert.ok(p.shares * p.price + bought <= final * 0.30 + 1e-8)
      }
    }
  }
})

test('DCA uses actual rather than reserved fees when tiny orders are omitted', () => {
  const plan = dca.calculateDcaPlan(
    [{ symbol: 'EXISTING', shares: 299.7, price: 1 }, { symbol: 'BBB', shares: 0, price: 1 }, { symbol: 'CCC', shares: 0, price: 1e9 }],
    [{ asset_key: 'BBB', target_pct: 30 }, { asset_key: 'CCC', target_pct: 30 }, { asset_key: 'DIME', target_pct: 40 }],
    700.3, { ...parameters, fee_per_order: 1 },
  )
  assert.equal(plan.status, 'READY'); assert.equal(plan.rows.length, 1); assert.equal(plan.fees, 1)
  assert.ok(plan.remaining_dime >= 400)
})

function dividendResponseHarness(responseFactory) {
  const h = accessHarness()
  let calls = 0
  const orders = []
  const route = load('app/api/dividend-intelligence/route.ts', {
    '@/lib/phase-a-context': { ...h.module, requirePhaseAPortfolio: async () => ({ userId: 'u1', portfolioId: 'p1', portfolioName: 'One' }) },
    '@/lib/dividend-intelligence': dividend,
    '@/lib/supabase/server': { createServiceClient: () => ({ rpc: (name, args, options) => {
      calls++; assert.equal(name, 'get_decrypted_portfolio_transactions')
      assert.equal(args.p_user_id, 'u1'); assert.equal(args.p_portfolio_id, 'p1'); assert.deepEqual(options, { count: 'exact' })
      const q = {
        eq: (k, v) => { assert.equal(k, 'transaction_type'); assert.equal(v, 'DIVIDEND'); return q },
        gte: () => q, lte: () => q,
        order: (k, options) => { orders.push(k); assert.deepEqual(options, { ascending: false }); return q },
        range: async (from, to) => { assert.equal(from, 0); assert.equal(to, 10000); return responseFactory() },
      }
      return q
    } }) },
  })
  return { read: () => route.GET(new Request('https://example.test?from=2026-01-01&to=2026-12-31')), calls: () => calls, orders }
}

for (const size of [0, 1, 499, 500, 501, 10000, 10001]) {
  test(`Dividend response boundary: ${size} records`, async () => {
    const rows = Array.from({ length: size }, (_, i) => div(String(i), 'AAA', 1))
    const h = dividendResponseHarness(() => ({ data: rows, count: size, error: null }))
    const response = await h.read()
    const body = await response.json()
    assert.equal(response.status, size > 10000 ? 409 : 200)
    if (size > 10000) assert.equal(body.total, undefined)
    else { assert.equal(body.total, size); assert.equal(body.count, size) }
    assert.equal(h.calls(), 1); assert.deepEqual(h.orders, ['trade_date', 'created_at', 'id'])
  })
}

test('Dividend response rejects row caps, missing/bad counts and duplicate IDs without totals', async () => {
  const rows = Array.from({ length: 501 }, (_, i) => div(String(i), 'AAA', 1))
  for (const result of [
    { data: rows.slice(0, 499), count: 501 }, { data: rows.slice(0, 1), count: 501 },
    { data: rows, count: null }, { data: rows, count: undefined }, { data: rows, count: NaN },
    { data: rows, count: -1 }, { data: rows, count: 501.5 },
    { data: [rows[0], rows[0]], count: 2 }, { data: [{ ...rows[0], id: '' }], count: 1 },
    { data: [{ ...rows[0], id: 1 }], count: 1 },
    { data: [], count: 1 }, { data: rows, count: 500 },
  ]) {
    const h = dividendResponseHarness(() => ({ ...result, error: null }))
    const response = await h.read()
    assert.equal(response.status, 503); assert.equal((await response.json()).total, undefined)
    assert.equal(h.calls(), 1)
  }
})

test('Concurrent insert/delete cannot mix independently paginated responses', async () => {
  for (const mutation of ['insert', 'delete']) {
    const source = Array.from({ length: 501 }, (_, i) => div(String(i), 'AAA', 1))
    const h = dividendResponseHarness(async () => {
      const snapshot = structuredClone(source)
      await Promise.resolve()
      if (mutation === 'insert') source.unshift(div('new', 'AAA', 9))
      else source.splice(0, 1)
      return { data: snapshot, count: snapshot.length, error: null }
    })
    const response = await h.read()
    assert.equal(response.status, 200)
    const body = await response.json(); assert.equal(body.total, 501); assert.equal(body.count, 501)
    assert.equal(h.calls(), 1)
  }
})

test('Dividend rejects an inconsistent count during a concurrent change', async () => {
  for (const count of [500, 502]) {
    const h = dividendResponseHarness(() => ({ data: Array.from({ length: 501 }, (_, i) => div(String(i), 'AAA', 1)), count, error: null }))
    const response = await h.read()
    assert.equal(response.status, 503); assert.equal((await response.json()).total, undefined)
  }
})

test('Large dividend sets truncated by the Data API never produce totals', async () => {
  for (const [count, status] of [[10000, 503], [10001, 409]]) {
    const h = dividendResponseHarness(() => ({ data: Array.from({ length: 1000 }, (_, i) => div(String(i), 'AAA', 1)), count, error: null }))
    const response = await h.read()
    assert.equal(response.status, status); assert.equal((await response.json()).total, undefined)
  }
})
test('Dividends include recorded cash only, sold stocks and inclusive dates', () => {
  const rows = [div('1', 'AAA', 2, '2026-01-01'), div('2', 'AAA', 3), div('3', 'SOLD', 4, '2026-12-31'), { ...div('4', 'AAA', 99), transaction_type: 'DEPOSIT' }, div('5', 'AAA', 8, '2025-12-31')]
  const summary = dividend.summarizeDividends(rows, '2026-01-01', '2026-12-31')
  assert.equal(summary.total, 9); assert.equal(summary.count, 3)
  assert.deepEqual(summary.by_symbol, [{ symbol: 'AAA', amount: 5, count: 2 }, { symbol: 'SOLD', amount: 4, count: 1 }])
  assert.equal(summary.by_month.length, 3); assert.equal(summary.forecast, null)
})
test('Dividends reject bad dates/amounts and retain legitimate same-value payments', () => {
  const summary = dividend.summarizeDividends([div('1', 'AAA', 0.004), div('2', 'AAA', 0.004), div('2', 'AAA', 0.004), div('3', 'AAA', NaN), div('4', 'AAA', -1), div('5', 'AAA', 1, '2026-02-30')], '2026-01-01', '2026-12-31')
  assert.equal(summary.total, 0.01); assert.equal(summary.count, 2); assert.equal(summary.invalid_rows, 3)
  for (const range of [['2026-02-30', '2026-10-01'], ['2026/01/01', '2026-10-01'], ['2026-10-02', '2026-10-01']]) assert.throws(() => dividend.parseDividendRange(...range))
  assert.equal(dividend.summarizeDividends([], '2026-01-01', '2026-12-31').total, 0)
})

function accessHarness({ signedIn = true, pin = true, selected, expected, portfolios = [{ id: 'p1', name: 'One', is_default: true }] } = {}) {
  let reads = 0
  const supabase = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'u1' } : null } }), getSession: async () => ({ data: { session: { access_token: 'synthetic-session' } } }) },
    from: table => {
      reads++; assert.equal(table, 'portfolios')
      return { select: () => ({ eq: (key, value) => { assert.equal(key, 'user_id'); assert.equal(value, 'u1'); return { order: async () => ({ data: portfolios, error: null }) } } }) }
    },
  }
  const accessModule = load('lib/phase-a-context.ts', {
    '@/lib/supabase/server': { createClient: async () => supabase },
    'next/headers': { cookies: async () => ({ get: key => ({ value: key === 'portfolio-cookie' ? selected : 'synthetic-pin' }) }) },
    '@/lib/portfolio-context': { ACTIVE_PORTFOLIO_COOKIE: 'portfolio-cookie' },
    '@/lib/pin-session': { PIN_SESSION_COOKIE_NAME: 'pin-cookie', getSupabaseSessionId: () => 'session', verifyPinSessionValue: async (_cookie, uid, sid) => { assert.equal(uid, 'u1'); assert.equal(sid, 'session'); return pin } },
  })
  return { module: accessModule, reads: () => reads, resolve: () => accessModule.requirePhaseAPortfolio(expected) }
}

function scannerApiHarness({
  signedIn = true,
  selectedPortfolioId = 'p1',
  pinValid = true,
  portfolios = [{ id: 'p1', name: 'One', is_default: true }, { id: 'p2', name: 'Two', is_default: false }],
  rows = [],
  holdingsError = null,
  watchlistRows = [],
  watchlistError = null,
  portfolioQueryError = null,
  staticUniverse = { ai: ['NVDA'], semis: ['AMD'], growth: ['SHOP'], quality: ['COST'], mine: [] },
} = {}) {
  const queryCalls = []
  const portfolioCalls = []
  const marketCalls = []
  let selected = selectedPortfolioId
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: signedIn ? { id: 'u1' } : null } }),
      getSession: async () => ({ data: { session: { access_token: 'synthetic-session' } } }),
    },
    from(table) {
      if (table === 'portfolios') {
        const query = {
          select(columns) { assert.equal(columns, 'id, name, is_default, created_at'); return query },
          eq(column, value) { portfolioCalls.push([column, value]); return query },
          order: async (column, options) => {
            assert.equal(column, 'created_at'); assert.deepEqual(options, { ascending: true })
            return { data: portfolios.map(row => ({ created_at: '2026-01-01', ...row })), error: portfolioQueryError }
          },
        }
        return query
      }
      assert.ok(['holdings', 'portfolio_watchlist_items'].includes(table), 'Scanner mine may query only selected-portfolio sources')
      const query = {
        select(columns) {
          assert.equal(columns, table === 'holdings' ? 'user_id, portfolio_id, symbol, shares' : 'user_id, portfolio_id, symbol')
          return query
        },
        eq(column, value) { queryCalls.push([column, value]); return query },
        gt(column, value) { assert.equal(table, 'holdings'); assert.equal(column, 'shares'); assert.equal(value, 0); return query },
        then(resolve, reject) {
          const result = table === 'holdings' ? { data: rows, error: holdingsError } : { data: watchlistRows, error: watchlistError }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return query
    },
  }
  const phaseA = load('lib/phase-a-context.ts', {
    'next/headers': { cookies: async () => ({ get: key => ({ value: key === 'portfolio-cookie' ? selected : 'synthetic-pin' }) }) },
    '@/lib/supabase/server': { createClient: async () => supabase },
    '@/lib/portfolio-context': { ACTIVE_PORTFOLIO_COOKIE: 'portfolio-cookie' },
    '@/lib/pin-session': {
      PIN_SESSION_COOKIE_NAME: 'pin-cookie', getSupabaseSessionId: () => 'session',
      verifyPinSessionValue: async (cookie, userId, sessionId) => { assert.equal(cookie, 'synthetic-pin'); assert.equal(userId, 'u1'); assert.equal(sessionId, 'session'); return pinValid },
    },
  })
  const PhaseAError = phaseA.PhaseAError
  const technical = {
    return20dPct: 1, return60dPct: 2, trend: 'up', rsi14: 55, weeklyRsi14: 54,
    macd: { histogram: 1 }, lastClose: 100, ema50: 95, scannerSupport: 90,
    scannerResistance: 110, scannerVolumeRatio: 1.1, week52High: 120,
    week52Low: 80, return1dPct: 0.2, ema200: 90, importantSupport: 85,
    importantSupportTouches: 2,
  }
  const route = load('app/api/scanner/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/supabase/server': { createClient: async () => supabase },
    '@/lib/phase-a-context': {
      PhaseAError,
      phaseAErrorResponse: phaseA.phaseAErrorResponse,
      requirePhaseAPortfolio: phaseA.requirePhaseAPortfolio,
    },
    '@/lib/portfolio-context': { isPortfolioFoundationMissing: error => ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(String(error?.code ?? '')) },
    '@/lib/scanner-universe': load('lib/scanner-universe.ts'),
    '@/lib/finnhub': { getUpcomingEarningsStatus: async symbol => { marketCalls.push(['earnings', symbol]); return { status: 'none', earnings: null } } },
    '@/lib/indicators': { getTechnicalIndicators: async symbol => { marketCalls.push(['technical', symbol]); return technical } },
    '@/lib/stock-scanner': {
      SCANNER_UNIVERSES: staticUniverse,
      MAX_SCAN_SYMBOLS: 12,
      dedupeScannerSymbols: groups => [...new Set(groups.flat().map(symbol => symbol.trim().toUpperCase()).filter(Boolean))],
      scoreScannerCandidate: () => ({ score: 1, label: 'watch', setup: 'HOLD', reasons: [], categoryScores: {} }),
    },
    '@/lib/all-time-high': { getAllTimeHigh: async symbol => { marketCalls.push(['ath', symbol]); return { allTimeHigh: 120 } } },
    '@/lib/ath': { getAthState: () => ({ distancePct: -16.7, status: 'below' }) },
  })
  return {
    queryCalls,
    portfolioCalls,
    marketCalls,
    get: (universe = 'mine', symbols = null) => {
      const url = new URL(`https://example.test/api/scanner?universe=${universe}`)
      if (symbols) url.searchParams.set('symbols', symbols.join(','))
      return route.GET({ nextUrl: url })
    },
    select: id => { selected = id },
  }
}

test('Scanner mine API returns selected-owner Holdings and Watchlist when switching A/B', async () => {
  const h = scannerApiHarness({ rows: [
    { user_id: 'u1', portfolio_id: 'p1', symbol: 'aapl', shares: 2 },
    { user_id: 'u1', portfolio_id: 'p2', symbol: 'MSFT', shares: 4 },
    { user_id: 'u2', portfolio_id: 'p1', symbol: 'TSLA', shares: 3 },
    { user_id: 'u1', portfolio_id: 'p1', symbol: 'ZERO', shares: 0 },
  ], watchlistRows: [
    { user_id: 'u1', portfolio_id: 'p1', symbol: 'aapl' },
    { user_id: 'u1', portfolio_id: 'p1', symbol: 'NVDA' },
    { user_id: 'u1', portfolio_id: 'p2', symbol: 'GOOG' },
    { user_id: 'u2', portfolio_id: 'p1', symbol: 'META' },
    { user_id: 'u1', portfolio_id: null, symbol: 'LEGACY' },
  ] })
  let response = await h.get()
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).items.map(row => row.symbol), ['AAPL', 'NVDA'])
  assert.ok(h.queryCalls.some(([key, value]) => key === 'user_id' && value === 'u1'))
  assert.ok(h.queryCalls.some(([key, value]) => key === 'portfolio_id' && value === 'p1'))

  h.select('p2')
  response = await h.get()
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).items.map(row => row.symbol), ['GOOG', 'MSFT'])
  assert.ok(h.queryCalls.some(([key, value]) => key === 'portfolio_id' && value === 'p2'))
})

test('Scanner mine fails closed on incomplete schemas and returns empty without market requests', async () => {
  const empty = scannerApiHarness()
  const response = await empty.get()
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).items, [])
  assert.equal(empty.marketCalls.length, 0)

  const noWatchlistFallback = scannerApiHarness({ rows: [], watchlistError: { code: '42P01', message: 'portfolio_watchlist_items missing' } })
  const failed = await noWatchlistFallback.get()
  assert.equal(failed.status, 503)
  assert.equal(noWatchlistFallback.marketCalls.length, 0)

  const legacySchema = scannerApiHarness({ portfolioQueryError: { code: '42703', message: 'multi-portfolio schema missing' } })
  const unavailable = await legacySchema.get()
  assert.equal(unavailable.status, 503)
  assert.ok(legacySchema.portfolioCalls.some(([key, value]) => key === 'user_id' && value === 'u1'))
  assert.equal(legacySchema.queryCalls.length, 0)
  assert.equal(legacySchema.marketCalls.length, 0)
})

test('Scanner API enforces Auth/PIN and rejects foreign portfolio selection before market access', async () => {
  const anonymous = await scannerApiHarness({ signedIn: false }).get()
  assert.equal(anonymous.status, 401)

  const locked = scannerApiHarness({ pinValid: false, rows: [{ user_id: 'u1', portfolio_id: 'p1', symbol: 'AAPL', shares: 1 }] })
  assert.equal((await locked.get()).status, 401)
  assert.equal(locked.portfolioCalls.length, 0)
  assert.equal(locked.queryCalls.length, 0)
  assert.equal(locked.marketCalls.length, 0)

  const foreign = scannerApiHarness({ rows: [{ user_id: 'u1', portfolio_id: 'p1', symbol: 'AAPL', shares: 1 }] })
  foreign.select('foreign-portfolio')
  assert.equal((await foreign.get()).status, 409)
  assert.ok(foreign.portfolioCalls.some(([key, value]) => key === 'user_id' && value === 'u1'))
  assert.equal(foreign.queryCalls.length, 0)
  assert.equal(foreign.marketCalls.length, 0)
})

test('Scanner static universes do not require portfolio context or query holdings', async () => {
  const h = scannerApiHarness()
  const response = await h.get('semis')
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).items.map(row => row.symbol), ['AMD'])
  assert.equal(h.queryCalls.length, 0)
  assert.ok(h.marketCalls.some(([, symbol]) => symbol === 'AMD'))
})

test('Scanner rejects more than 12 allowed symbols with HTTP 413 before any market provider request', async () => {
  const symbols = Array.from({ length: 13 }, (_, index) => `SYN${index + 1}`)
  const h = scannerApiHarness({
    staticUniverse: { ai: symbols, semis: [], growth: [], quality: [], mine: [] },
  })
  const response = await h.get('all', symbols)
  assert.equal(response.status, 413)
  assert.match((await response.json()).error, /ไม่เกิน 12 หุ้น/)
  assert.equal(h.marketCalls.length, 0, 'Over-cap requests must be rejected before SPY or ticker provider calls')
})

test('Read-only context rejects Auth/PIN before portfolio reads', async () => {
  for (const options of [{ signedIn: false }, { pin: false }]) {
    const h = accessHarness(options)
    await assert.rejects(h.resolve(), error => error.status === 401)
    assert.equal(h.reads(), 0)
  }
})
test('Read-only context never creates portfolios; rejects stale/foreign targets', async () => {
  for (const options of [{ portfolios: [] }, { selected: 'foreign' }, { expected: 'p2' }]) await assert.rejects(accessHarness(options).resolve(), error => error.status === 409)
  assert.equal((await accessHarness().resolve()).portfolioId, 'p1')
})

function readQuery(table, data, calls, error = null) {
  const query = { select: () => query, eq: (k, v) => { calls.push([table, k, v]); return query }, limit: () => query, maybeSingle: async () => ({ data, error }), then: (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject) }
  return query
}
test('DCA POST reloads scoped server data; ignores forged client balance and uses bounded quotes', async () => {
  const calls = []
  const supabase = { from: table => readQuery(table, { holdings: [{ symbol: 'AAA', shares: 200 }, { symbol: 'BBB', shares: 100 }], user_settings: { dime_balance: 700 }, portfolio_allocation_targets: targets }[table], calls) }
  const h = accessHarness()
  const route = load('app/api/smart-dca/route.ts', {
    '@/lib/phase-a-context': { ...h.module, requirePhaseAPortfolio: async id => { assert.equal(id, 'p1'); return { supabase, userId: 'u1', portfolioId: 'p1', portfolioName: 'One' } } },
    '@/lib/smart-dca': dca,
    '@/lib/finnhub': { getQuote: async () => ({ c: 1, t: Math.floor(Date.now() / 1000) }) },
  })
  const response = await route.POST(new Request('https://example.test/api/smart-dca', { method: 'POST', body: JSON.stringify({ ...parameters, portfolio_id: 'p1', dime_balance: 999999, positions: [] }) }))
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.plan.portfolio_value, 1000); assert.equal(payload.dime_balance, 700)
  for (const table of ['holdings', 'user_settings', 'portfolio_allocation_targets']) {
    assert.ok(calls.some(c => c[0] === table && c[1] === 'user_id' && c[2] === 'u1'))
    assert.ok(calls.some(c => c[0] === table && c[1] === 'portfolio_id' && c[2] === 'p1'))
  }
  assert.equal((await route.POST(new Request('https://example.test', { method: 'POST', body: '[]' }))).status, 400)
})
test('DCA API marks stale and future quotes unavailable and blocks an incomplete valuation', async () => {
  const h = accessHarness()
  for (const t of [0, Math.floor(Date.now() / 1000) + 3600]) {
    const route = load('app/api/smart-dca/route.ts', {
      '@/lib/phase-a-context': { ...h.module, requirePhaseAPortfolio: async () => ({ supabase: { from: table => readQuery(table, { holdings: [{ symbol: 'AAA', shares: 1 }], user_settings: { dime_balance: 700 }, portfolio_allocation_targets: targets }[table], []) }, userId: 'u1', portfolioId: 'p1', portfolioName: 'One' }) },
      '@/lib/smart-dca': dca, '@/lib/finnhub': { getQuote: async () => ({ c: 100, t }) },
    })
    const result = await route.POST(new Request('https://example.test', { method: 'POST', body: JSON.stringify({ ...parameters, portfolio_id: 'p1' }) }))
    assert.equal((await result.json()).plan.status, 'BLOCKED')
  }
})
test('Dividend API scopes one complete RPC response and never calls a market provider', async () => {
  const h = accessHarness()
  let pages = 0
  const route = load('app/api/dividend-intelligence/route.ts', {
    '@/lib/phase-a-context': { ...h.module, requirePhaseAPortfolio: async id => { assert.equal(id, 'p1'); return { userId: 'u1', portfolioId: 'p1', portfolioName: 'One' } } },
    '@/lib/dividend-intelligence': dividend,
    '@/lib/supabase/server': { createServiceClient: () => ({ rpc: (name, args, options) => {
      assert.equal(name, 'get_decrypted_portfolio_transactions'); assert.equal(args.p_user_id, 'u1'); assert.equal(args.p_portfolio_id, 'p1')
      assert.deepEqual(options, { count: 'exact' })
      const q = { eq: (key, value) => { assert.equal(key, 'transaction_type'); assert.equal(value, 'DIVIDEND'); return q }, gte: () => q, lte: () => q, order: () => q, range: async (from, to) => { assert.equal(from, 0); assert.equal(to, 10000); pages++; return { data: [...Array.from({ length: 500 }, (_, i) => div(String(i), 'AAA', 1)), div('500', 'SOLD', 2)], count: 501, error: null } } }; return q
    } }) },
  })
  const response = await route.GET(new Request('https://example.test/api/dividend-intelligence?portfolio_id=p1&from=2026-01-01&to=2026-12-31'))
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.total, 502); assert.equal(payload.count, 501); assert.equal(pages, 1)
  assert.equal((await route.GET(new Request('https://example.test?from=invalid'))).status, 400)
})
test('API authorization failures do not reach market or financial queries', async () => {
  const h = accessHarness()
  const denied = { ...h.module, requirePhaseAPortfolio: async () => { throw new h.module.PhaseAError('PIN required', 401) } }
  const dcaRoute = load('app/api/smart-dca/route.ts', { '@/lib/phase-a-context': denied, '@/lib/smart-dca': dca, '@/lib/finnhub': { getQuote: () => { throw new Error('must not call') } } })
  assert.equal((await dcaRoute.GET()).status, 401)
  const divRoute = load('app/api/dividend-intelligence/route.ts', { '@/lib/phase-a-context': denied, '@/lib/dividend-intelligence': dividend, '@/lib/supabase/server': { createServiceClient: () => { throw new Error('must not call') } } })
  assert.equal((await divRoute.GET(new Request('https://example.test'))).status, 401)
})

test('DCA read-only POST rejects cross-origin and oversized requests without loading financial data', async () => {
  const h = accessHarness()
  const route = load('app/api/smart-dca/route.ts', {
    '@/lib/phase-a-context': { ...h.module, requirePhaseAPortfolio: () => { throw new Error('must not load') } },
    '@/lib/smart-dca': dca, '@/lib/finnhub': { getQuote: () => { throw new Error('must not load') } },
  })
  assert.equal((await route.POST(new Request('https://example.test/api/smart-dca', { method: 'POST', headers: { origin: 'https://foreign.test' }, body: '{}' }))).status, 403)
  assert.equal((await route.POST(new Request('https://example.test/api/smart-dca', { method: 'POST', body: 'x'.repeat(4097) }))).status, 413)
})

test('DCA quote concurrency stays bounded and data errors are not interpreted as zero balances', async () => {
  const h = accessHarness()
  let active = 0, peak = 0
  const rows = Array.from({ length: 9 }, (_, i) => ({ symbol: `S${i}`, shares: 1 }))
  const fake = table => readQuery(table, { holdings: rows, user_settings: { dime_balance: 700 }, portfolio_allocation_targets: [{ asset_key: 'DIME', target_pct: 100 }] }[table], [])
  const route = load('app/api/smart-dca/route.ts', {
    '@/lib/phase-a-context': { ...h.module, requirePhaseAPortfolio: async () => ({ supabase: { from: fake }, userId: 'u1', portfolioId: 'p1', portfolioName: 'One' }) },
    '@/lib/smart-dca': dca,
    '@/lib/finnhub': { getQuote: async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return { c: 1, t: Math.floor(Date.now() / 1000) } } },
  })
  assert.equal((await route.GET()).status, 200); assert.equal(peak, 4)
  const failureRoute = load('app/api/smart-dca/route.ts', {
    '@/lib/phase-a-context': { ...h.module, requirePhaseAPortfolio: async () => ({ supabase: { from: table => readQuery(table, null, [], { message: 'synthetic private error' }) }, userId: 'u1', portfolioId: 'p1', portfolioName: 'One' }) },
    '@/lib/smart-dca': dca, '@/lib/finnhub': { getQuote: () => { throw new Error('must not quote on read failure') } },
  })
  const response = await failureRoute.GET()
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /synthetic private/)
})

test('Dividend API returns an error rather than a zero total when the RPC fails', async () => {
  const h = accessHarness()
  const route = load('app/api/dividend-intelligence/route.ts', {
    '@/lib/phase-a-context': { ...h.module, requirePhaseAPortfolio: async () => ({ userId: 'u1', portfolioId: 'p1', portfolioName: 'One' }) },
    '@/lib/dividend-intelligence': dividend,
    '@/lib/supabase/server': { createServiceClient: () => ({ rpc: () => {
      const q = { eq: () => q, gte: () => q, lte: () => q, order: () => q, range: async () => ({ data: null, count: null, error: { message: 'synthetic private error' } }) }; return q
    } }) },
  })
  const response = await route.GET(new Request('https://example.test?from=2026-01-01&to=2026-12-31'))
  assert.equal(response.status, 503)
  const body = await response.json(); assert.equal(body.total, undefined); assert.doesNotMatch(body.error, /synthetic private/)
})
