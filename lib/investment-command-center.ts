export type CommandCenterStatus = 'READY' | 'STALE' | 'UNAVAILABLE' | 'ERROR' | 'NOT_REQUESTED'

export interface SnapshotSource<T> {
  status: CommandCenterStatus
  source: string
  fetchedAt: string | null
  observedAt: string | null
  data: T | null
  message?: string
}

interface ScopedRow {
  userId: string
  portfolioId: string
}

export interface CommandCenterHolding extends ScopedRow {
  symbol: string
  shares: number
  costBasis: number | null
  updatedAt: string | null
}

export interface CommandCenterBalance {
  cashBalance: number | null
  dimeBalance: number | null
  initialCapital: number | null
  dimeUpdatedAt: string | null
}

export interface CommandCenterWatchlistItem extends ScopedRow {
  id: string
  symbol: string
  collectionId: string | null
  targetPrice: number | null
  alertEnabled: boolean
  updatedAt: string | null
}

export interface CommandCenterCollection extends ScopedRow {
  id: string
  name: string
  sortOrder: number
  updatedAt: string | null
}

export interface CommandCenterAllocation extends ScopedRow {
  assetKey: string
  targetPct: number
  updatedAt: string | null
}

export interface CommandCenterRule extends ScopedRow {
  id: string
  enabled: boolean
  updatedAt: string | null
}

export interface CommandCenterPlan extends ScopedRow {
  symbol: string
  status: string
}

export interface CommandCenterQuote {
  price: number | null
  source: 'Finnhub'
  fetchedAt: string
  providerTimestamp: string | null
  freshness: 'fresh' | 'stale' | 'unknown' | 'unavailable'
}

export interface InvestmentCommandCenterInput {
  generatedAt: string
  userId: string
  portfolio: { id: string; name: string }
  holdings: SnapshotSource<CommandCenterHolding[]>
  balances: SnapshotSource<CommandCenterBalance>
  watchlist: SnapshotSource<CommandCenterWatchlistItem[]>
  collections: SnapshotSource<CommandCenterCollection[]>
  allocations: SnapshotSource<CommandCenterAllocation[]>
  rules: SnapshotSource<CommandCenterRule[]>
  plans: SnapshotSource<CommandCenterPlan[]>
  market: {
    requested: boolean
    fetchedAt?: string
    observations: Record<string, CommandCenterQuote>
  }
}

export class InvestmentCommandCenterScopeError extends Error {
  constructor() {
    super('Investment command center source data does not match the authenticated portfolio')
    this.name = 'InvestmentCommandCenterScopeError'
  }
}

function assertRowsScoped<T extends ScopedRow>(rows: T[], userId: string, portfolioId: string): void {
  if (rows.some(row => row.userId !== userId || row.portfolioId !== portfolioId)) {
    throw new InvestmentCommandCenterScopeError()
  }
}

function validNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value)
}

function scopedSection<T>(portfolioId: string, source: SnapshotSource<T>) {
  return {
    portfolioId,
    status: source.status,
    source: source.source,
    fetchedAt: source.fetchedAt,
    observedAt: source.observedAt,
    data: source.status === 'READY' ? source.data : null,
    ...(source.message ? { message: source.message } : {}),
  }
}

export function buildInvestmentCommandCenterSnapshot(input: InvestmentCommandCenterInput) {
  const { userId, portfolio } = input
  const portfolioId = portfolio.id

  if (input.holdings.status === 'READY') assertRowsScoped(input.holdings.data ?? [], userId, portfolioId)
  if (input.watchlist.status === 'READY') assertRowsScoped(input.watchlist.data ?? [], userId, portfolioId)
  if (input.collections.status === 'READY') assertRowsScoped(input.collections.data ?? [], userId, portfolioId)
  if (input.allocations.status === 'READY') assertRowsScoped(input.allocations.data ?? [], userId, portfolioId)
  if (input.rules.status === 'READY') assertRowsScoped(input.rules.data ?? [], userId, portfolioId)
  if (input.plans.status === 'READY') assertRowsScoped(input.plans.data ?? [], userId, portfolioId)

  const holdings = input.holdings.status === 'READY' ? input.holdings.data ?? [] : []
  const balances = input.balances.status === 'READY' ? input.balances.data : null
  const watchlist = input.watchlist.status === 'READY' ? input.watchlist.data ?? [] : []
  const collections = input.collections.status === 'READY' ? input.collections.data ?? [] : []
  const allocations = input.allocations.status === 'READY' ? input.allocations.data ?? [] : []
  const rules = input.rules.status === 'READY' ? input.rules.data ?? [] : []
  const plans = input.plans.status === 'READY' ? input.plans.data ?? [] : []

  const holdingsKnown = input.holdings.status === 'READY'
  const investedCostBasis = !holdingsKnown
    ? null
    : holdings.length === 0
    ? 0
      : holdings.every(row => /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(row.symbol) && Number.isFinite(row.shares) && row.shares > 0 && validNumber(row.costBasis) && row.costBasis >= 0)
      ? Math.round(holdings.reduce((total, row) => total + row.shares * (row.costBasis ?? 0), 0) * 100) / 100
      : null

  const holdingsValid = holdings.every(row => /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(row.symbol) && Number.isFinite(row.shares) && row.shares > 0)
  const uniqueHoldingSymbols = Array.from(new Set(holdings.map(row => row.symbol.trim().toUpperCase()).filter(Boolean)))
  const marketRequested = input.market.requested
  const marketObservations = Object.fromEntries(
    Object.entries(input.market.observations).map(([symbol, observation]) => [symbol.toUpperCase(), observation])
  )
  const allHoldingsFresh = holdingsKnown && holdingsValid && uniqueHoldingSymbols.every(symbol => {
    const quote = marketObservations[symbol]
    return Boolean(quote && validNumber(quote.price) && quote.price > 0 && quote.freshness === 'fresh' && quote.providerTimestamp)
  })
  const hasStaleOrUnknown = uniqueHoldingSymbols.some(symbol => {
    const freshness = marketObservations[symbol]?.freshness
    return freshness === 'stale' || freshness === 'unknown'
  })
  const marketValue = marketRequested && allHoldingsFresh
    ? Math.round(holdings.reduce((total, row) => total + row.shares * (marketObservations[row.symbol.toUpperCase()]?.price ?? 0), 0) * 100) / 100
    : null
  const costBasisComplete = investedCostBasis !== null
  const unrealizedPnl = marketValue !== null && costBasisComplete
    ? Math.round((marketValue - investedCostBasis) * 100) / 100
    : null

  const marketStatus: CommandCenterStatus = !marketRequested
    ? 'NOT_REQUESTED'
    : allHoldingsFresh
      ? 'READY'
      : hasStaleOrUnknown
        ? 'STALE'
        : 'UNAVAILABLE'

  const sections = {
    holdings: scopedSection(portfolioId, input.holdings),
    balances: scopedSection(portfolioId, input.balances),
    watchlist: scopedSection(portfolioId, input.watchlist),
    collections: scopedSection(portfolioId, input.collections),
    allocations: scopedSection(portfolioId, input.allocations),
    rules: scopedSection(portfolioId, input.rules),
    plans: scopedSection(portfolioId, input.plans),
    market: {
      portfolioId,
      status: marketStatus,
      source: marketRequested ? 'Finnhub' : 'ยังไม่ได้ร้องขอข้อมูลตลาด',
      fetchedAt: marketRequested ? input.market.fetchedAt ?? null : null,
      observedAt: null,
      data: marketRequested ? {
        observations: marketObservations,
        coverageComplete: allHoldingsFresh,
        requestedSymbolCount: Object.keys(marketObservations).length,
        missingHoldingSymbols: !holdingsValid && holdingsKnown
          ? [...new Set(holdings.filter(row => !/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(row.symbol) || !Number.isFinite(row.shares) || row.shares <= 0).map(row => row.symbol || 'INVALID_HOLDING_INPUT'))]
          : uniqueHoldingSymbols.filter(symbol => {
          const quote = marketObservations[symbol]
          return !quote || !validNumber(quote.price) || quote.price <= 0 || quote.freshness !== 'fresh' || !quote.providerTimestamp
          }),
      } : null,
      ...(!marketRequested ? { message: 'กดอัปเดตราคาเพื่อร้องขอข้อมูลตลาด โดยจำกัดไม่เกิน 12 Ticker' } : {}),
    },
    risk: {
      portfolioId,
      status: 'NOT_REQUESTED' as const,
      source: 'Risk Dashboard เดิม',
      fetchedAt: null,
      observedAt: null,
      data: null,
      message: 'ไม่ได้เรียก Risk Provider อัตโนมัติ; เปิดหน้าความเสี่ยงเพื่อดูการคำนวณเดิม',
    },
    alertEvaluation: {
      portfolioId,
      status: 'NOT_REQUESTED' as const,
      source: 'กฎการลงทุนที่ตั้งไว้; ยังไม่ได้ประเมินราคา',
      fetchedAt: null,
      observedAt: null,
      data: null,
      message: 'กฎติดตามไม่ใช่ Alert ที่ประเมินแล้ว; เปิดหน้าการแจ้งเตือนเพื่อประเมินข้อมูลล่าสุด',
    },
  }

  return {
    generatedAt: input.generatedAt,
    portfolio: { ...portfolio },
    overview: {
      holdingCount: holdings.length,
      investedCostBasis,
      marketValue,
      unrealizedPnl,
      cashBalance: balances?.cashBalance ?? null,
      dimeBalance: balances?.dimeBalance ?? null,
      initialCapital: balances?.initialCapital ?? null,
      marketCoverageComplete: marketValue !== null,
    },
    sections: {
      ...sections,
      watchlist: {
        ...sections.watchlist,
        data: sections.watchlist.status === 'READY'
          ? watchlist.map(({ id, symbol, collectionId, targetPrice, alertEnabled, updatedAt }) => ({ id, symbol, collectionId, targetPrice, alertEnabled, updatedAt }))
          : null,
      },
      collections: {
        ...sections.collections,
        data: sections.collections.status === 'READY'
          ? collections.map(({ id, name, sortOrder, updatedAt }) => ({ id, name, sortOrder, updatedAt }))
          : null,
      },
      allocations: {
        ...sections.allocations,
        data: sections.allocations.status === 'READY'
          ? allocations.map(({ assetKey, targetPct, updatedAt }) => ({ assetKey, targetPct, updatedAt }))
          : null,
      },
      rules: {
        ...sections.rules,
        data: sections.rules.status === 'READY'
          ? { total: rules.length, enabled: rules.filter(rule => rule.enabled).length, evaluated: false }
          : null,
      },
      plans: {
        ...sections.plans,
        data: sections.plans.status === 'READY'
          ? { total: plans.length, active: plans.filter(plan => ['WAITING', 'ENTERED'].includes(plan.status.toUpperCase())).length }
          : null,
      },
    },
  }
}
