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

// เก็บไว้เพื่อ backward-compat กับโค้ดเก่า (ไม่ใช้แล้วหลังอัปเกรดเป็น DetailedAnalysisResult)
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
  analysedAt?: string
  usedPrice?: number | null
  usedPE?: number | null
  usedNews?: Array<{ headline: string; headlineTh?: string; impact: string }>
}

export interface TechnicalSnapshot {
  ema50: number | null
  ema100: number | null
  ema200: number | null
  rsi14: number | null
  macd: { macd: number | null; signal: number | null; histogram: number | null }
  bollinger: { upper: number | null; middle: number | null; lower: number | null }
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  lastClose: number | null
  support: number | null
  resistance: number | null
  volumeRatio: number | null
}

export interface EarningsInfo {
  date: string
  daysUntil: number
  hour: string | null
}

// ผลวิเคราะห์เชิงลึกแบบสถาบันการเงิน — เทคนิคัล + ข่าว + ความเสี่ยง/โอกาส + แผนเทรด
export interface DetailedAnalysisResult {
  symbol: string
  disclaimer: string
  technicalSummary: string
  newsImpact: string[]
  risksAndOpportunities: {
    caution: string
    opportunity: string
  }
  recommendation: {
    action: 'BUY' | 'HOLD' | 'SELL_PARTIAL' | 'SELL_ALL'
    buyConditions: string
    sellConditions: string
  }
  risks: string[]
  summary: string
  analysedAt: string
  // sector/business ใช้กับ Donut chart แยกตาม sector
  sector?: string
  business?: string
  // metadata แหล่งข้อมูลจริงที่ใช้วิเคราะห์ (โชว์ให้ user เห็นว่าไม่ใช่ AI เดาเอง)
  technical: TechnicalSnapshot
  usedPrice: number | null
  usedNews: Array<{ headline: string; headlineTh?: string; impact: string }>
  // ระบุเมื่อวิเคราะห์ไม่สำเร็จจริงๆ (เช่น Groq เกินโควต้ารายวัน) — UI ต้องแยกแสดงจากผลวิเคราะห์จริง
  error?: 'RATE_LIMIT' | 'FAILED'
  // วันประกาศงบที่ใกล้ที่สุด (ถ้ามีข้อมูล) — ใช้เตือนความเสี่ยงก่อนสัญญาณเทคนิคัลจะไม่มีความหมาย
  earnings?: EarningsInfo | null
  // โมเดล Groq ที่ตอบสำเร็จจริง — โชว์บน UI เพื่อความโปร่งใส (คุณภาพต่างกันระหว่างโมเดลหลัก/สำรอง)
  usedModel?: string
}

export interface HoldingFormData {
  symbol: string
  shares: string
  cost_basis: string
  notes: string
}
