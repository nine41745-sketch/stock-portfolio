export interface Holding {
  id: string
  user_id: string
  symbol: string
  shares: number
  cost_basis: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface HoldingWithPrice extends Holding {
  current_price: number | null
  market_value: number | null
  total_cost: number | null
  pnl: number | null
  pnl_pct: number | null
  dayChange?: number | null
  pe?: number | null
  week52High?: number | null
  week52Low?: number | null
}

export interface FinnhubQuote {
  c: number
  h: number
  l: number
  o: number
  pc: number
  dp: number
  t: number
}

export interface NewsItem {
  symbol: string
  headline: string
  headlineTh: string
  source: string
  datetime: number
  url: string
  impact: 'NEGATIVE' | 'POSITIVE' | 'NEUTRAL' | 'LOW'
}

export interface AnalysisResult {
  symbol: string
  signal: 'BUY' | 'HOLD' | 'SELL_PARTIAL' | 'SELL_ALL'
  summary: string
  reasons: string[]
  detail: string
  action: string
  sector?: string
  business?: string
  targetCustomers?: string
}

export interface HoldingFormData {
  symbol: string
  shares: string
  cost_basis: string
  notes: string
}
