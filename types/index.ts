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
  pe?: number | null
  rsi?: number | null
  week52High?: number | null
  week52Low?: number | null
}

export interface FinnhubQuote {
  c: number   // current price
  h: number   // high
  l: number   // low
  o: number   // open
  pc: number  // previous close
  t: number   // timestamp
}

export interface NewsItem {
  symbol: string
  headline: string
  headlineTh: string
  source: string
  datetime: number
  url: string
  impact: 'HIGH' | 'MEDIUM' | 'LOW'
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
