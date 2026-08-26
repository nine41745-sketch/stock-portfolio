import { DetailedAnalysisResult, EarningsInfo, HoldingWithPrice, NewsItem, TechnicalSnapshot } from '@/types'
import { getStockMeta } from './stock-meta'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'openai/gpt-oss-120b'
const GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b'

const VALID_ACTIONS = ['BUY', 'HOLD', 'SELL_PARTIAL', 'SELL_ALL'] as const
const VALID_NEWS_IMPACTS = ['NEGATIVE', 'POSITIVE', 'NEUTRAL', 'LOW'] as const
const ALLOWED_SELL_ALL_EVIDENCE_TYPES = [
  'FUNDAMENTAL_DETERIORATION',
  'FRAUD_GOVERNANCE',
  'SOLVENCY_LIQUIDITY',
  'STRUCTURAL_COMPETITIVE_LOSS',
  'SEVERE_REGULATORY_LEGAL',
  'BUSINESS_MODEL_IMPAIRMENT',
  'OTHER_PERMANENT_IMPAIRMENT',
] as const

type AnalysisAction = DetailedAnalysisResult['recommendation']['action']
type AnalysisError = NonNullable<DetailedAnalysisResult['error']>
type NewsImpact = NewsItem['impact']

export interface PortfolioBatchHoldingInput {
  holding: HoldingWithPrice
  technical: TechnicalSnapshot
  earnings: EarningsInfo | null
  news: NewsItem[]
}

export interface PortfolioBatchOutcome {
  results: Record<string, DetailedAnalysisResult>
  error: AnalysisError | null
  usedModel: string | null
  message?: string
}

interface GroqBatchCallResult {
  text: string
  rateLimited: boolean
  usedModel: string | null
}

interface BatchAIItem {
  symbol?: unknown
  action?: unknown
  thesisBroken?: unknown
  sellAllEvidenceTypes?: unknown
  sellAllEvidence?: unknown
  summary?: unknown
  buyConditions?: unknown
  sellConditions?: unknown
  newsImpact?: unknown
  caution?: unknown
  opportunity?: unknown
  risks?: unknown
  news?: unknown
}

function safeNumber(value: number | null | undefined, digits = 2): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : null
}

function trimText(value: unknown, maxChars: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxChars) : ''
}

function stringArray(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, maxItems)
    .map(item => item.trim().slice(0, maxChars))
}

function technicalSummary(holding: HoldingWithPrice, technical: TechnicalSnapshot): string {
  const parts = [
    `ราคา ${holding.current_price != null ? `$${holding.current_price.toFixed(2)}` : 'N/A'}`,
    `แนวโน้ม ${technical.trend}`,
    technical.ema50 != null ? `EMA50 $${technical.ema50}` : null,
    technical.ema100 != null ? `EMA100 $${technical.ema100}` : null,
    technical.ema200 != null ? `EMA200 $${technical.ema200}` : null,
    technical.rsi14 != null ? `RSI Day ${technical.rsi14}` : null,
    technical.weeklyRsi14 != null ? `RSI Week ${technical.weeklyRsi14}` : null,
    technical.macd.histogram != null ? `MACD Hist ${technical.macd.histogram}` : null,
    technical.support != null ? `แนวรับ $${technical.support}` : null,
    technical.resistance != null ? `แนวต้าน $${technical.resistance}` : null,
    technical.bollinger.lower != null && technical.bollinger.upper != null
      ? `BB $${technical.bollinger.lower}/$${technical.bollinger.upper}`
      : null,
    technical.volumeRatio != null ? `Volume ${technical.volumeRatio}x` : null,
  ].filter(Boolean)
  return parts.join(' | ')
}

function compactInput(
  input: PortfolioBatchHoldingInput,
  totalPortfolioValue: number | null,
): Record<string, unknown> {
  const { holding: h, technical: t, earnings, news } = input
  const weight = totalPortfolioValue !== null && totalPortfolioValue > 0 && h.market_value != null
    ? (h.market_value / totalPortfolioValue) * 100
    : null

  return {
    s: h.symbol,
    px: safeNumber(h.current_price),
    cost: safeNumber(h.cost_basis),
    sh: safeNumber(h.shares, 4),
    pnl: safeNumber(h.pnl_pct, 1),
    w: safeNumber(weight, 1),
    pe: safeNumber(h.pe, 1),
    hi: safeNumber(h.week52High),
    lo: safeNumber(h.week52Low),
    t: {
      tr: t.trend,
      e50: safeNumber(t.ema50),
      e100: safeNumber(t.ema100),
      e200: safeNumber(t.ema200),
      rsi: safeNumber(t.rsi14, 1),
      wrsi: safeNumber(t.weeklyRsi14, 1),
      mh: safeNumber(t.macd.histogram, 2),
      bbu: safeNumber(t.bollinger.upper),
      bbl: safeNumber(t.bollinger.lower),
      sup: safeNumber(t.support),
      res: safeNumber(t.resistance),
      vol: safeNumber(t.volumeRatio, 2),
    },
    earn: earnings ? { d: earnings.daysUntil, date: earnings.date } : null,
    news: news.slice(0, 2).map(n => n.headline.slice(0, 100)),
  }
}

async function callModel(prompt: string, maxTokens: number, model: string): Promise<GroqBatchCallResult> {
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: maxTokens,
        temperature: 0.4,
        reasoning_effort: 'low',
        reasoning_format: 'hidden',
      }),
    })

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after') ?? 'unknown'
      const err = await res.text()
      console.warn(`[portfolio-batch] 429 ${model} retry-after=${retryAfter}s: ${err.slice(0, 160)}`)
      return { text: '', rateLimited: true, usedModel: null }
    }
    if (!res.ok) {
      const err = await res.text()
      console.error(`[portfolio-batch] HTTP ${res.status} ${model}: ${err.slice(0, 160)}`)
      return { text: '', rateLimited: false, usedModel: null }
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    return { text, rateLimited: false, usedModel: text ? model : null }
  } catch (error) {
    console.error(`[portfolio-batch] network error ${model}:`, error)
    return { text: '', rateLimited: false, usedModel: null }
  }
}

async function callGroqBatch(prompt: string, maxTokens: number): Promise<GroqBatchCallResult> {
  const primary = await callModel(prompt, maxTokens, GROQ_MODEL)
  if (primary.text) return primary
  if (!primary.rateLimited) return primary

  const fallback = await callModel(prompt, maxTokens, GROQ_FALLBACK_MODEL)
  if (fallback.text) return fallback
  return {
    text: '',
    rateLimited: primary.rateLimited || fallback.rateLimited,
    usedModel: null,
  }
}

export async function analyzePortfolioBatch(
  inputs: PortfolioBatchHoldingInput[],
  cashBalance: number,
  totalPortfolioValue: number | null,
): Promise<PortfolioBatchOutcome> {
  if (!inputs.length) return { results: {}, error: null, usedModel: null }

  const cashRatio = totalPortfolioValue !== null && totalPortfolioValue > 0
    ? (cashBalance / (totalPortfolioValue + cashBalance)) * 100
    : null
  const portfolioWeights = inputs
    .map(({ holding }) => {
      const weight = totalPortfolioValue !== null && totalPortfolioValue > 0 && holding.market_value != null
        ? (holding.market_value / totalPortfolioValue) * 100
        : null
      return `${holding.symbol}:${weight == null ? 'N/A' : `${weight.toFixed(1)}%`}`
    })
    .join(',')

  const payload = inputs.map(input => compactInput(input, totalPortfolioValue))
  const prompt = `คุณเป็น Institutional Portfolio Manager วิเคราะห์หุ้นทุกตัวด้านล่างพร้อมกันเป็น "พอร์ตเดียว" เพื่อทำ Daily Portfolio Review

กติกา action เรียงลำดับความสำคัญ:
1) SELL_ALL: ใช้ได้เฉพาะมี thesis-breaking เฉพาะบริษัทจริง และต้อง thesisBroken=true + sellAllEvidenceTypes อย่างน้อย 1 ค่าใน allowlist: FUNDAMENTAL_DETERIORATION,FRAUD_GOVERNANCE,SOLVENCY_LIQUIDITY,STRUCTURAL_COMPETITIVE_LOSS,SEVERE_REGULATORY_LEGAL,BUSINESS_MODEL_IMPAIRMENT,OTHER_PERMANENT_IMPAIRMENT เท่านั้น ห้าม SELL_ALL จาก EMA/MACD/RSI/downtrend/P&L ขาดทุน/ข่าว macro-sector-ETF เพียงอย่างเดียว
2) SELL_PARTIAL: พิจารณาเมื่อ P&L>20%, RSI Day>70, หรือราคาทะลุ Resistance/52W High/BB Upper พร้อม P&L>15%, หรือ fundamentals เริ่มเสื่อมแต่ยังไม่ thesis-breaking
3) BUY: เมื่อยังไม่เข้า 1-2, earnings ไม่อยู่ใน 7 วัน, ไม่มีข่าวเฉพาะบริษัทลบรุนแรง และมีอย่างน้อยหนึ่งอย่าง: UPTREND, RSI Day<45, ราคาใกล้/ต่ำกว่า Support ต้องคำนึง position weight และเงินสด ห้ามซื้อเพิ่มหนักเมื่อ concentration สูง ~25-30%+
4) HOLD: เมื่อไม่เข้าเงื่อนไขข้างต้น หรือ technical อ่อนแอแต่ thesis ยังไม่เสีย

ต้องแยกข่าว company-specific ออกจาก macro/sector; ข่าวภาพรวมห้ามใช้เป็น thesis break
P/E เป็น trailing/normalized ไม่มี forward P/E/timestamp: ถ้าข้อมูลไม่พอให้ระบุ valuation confidence ต่ำ ห้ามเดาตัวเลข
buyConditions/sellConditions ใช้เฉพาะ Support/Resistance/EMA/BB/52W ที่ให้มา ห้ามสร้างราคาเอง
มองทั้งพอร์ตร่วมกัน: สัดส่วน, concentration, เงินสด, P&L และหุ้นอื่นที่ถืออยู่

พอร์ต: stockValue=${totalPortfolioValue == null ? 'N/A' : totalPortfolioValue.toFixed(2)}, cash=${cashBalance.toFixed(2)}, cashPct=${cashRatio == null ? 'N/A' : cashRatio.toFixed(1)}, weights=${portfolioWeights}

ตอบ JSON object เท่านั้น รูป {"analyses":[...]} และต้องมีหุ้นทุกตัวจาก input exactly once
แต่ละ item ให้สั้น กระชับ:
{"symbol":"META","action":"BUY|HOLD|SELL_PARTIAL|SELL_ALL","thesisBroken":false,"sellAllEvidenceTypes":[],"sellAllEvidence":[],"summary":"ไทย 1-2 ประโยค ครอบคลุมพื้นฐาน/valuation/ผลต่อพอร์ต","buyConditions":"ไทยสั้นๆ หรือ N/A","sellConditions":"ไทยสั้นๆ หรือ N/A","newsImpact":["ไทยสั้นๆ"],"caution":"ไทยสั้นๆ","opportunity":"ไทยสั้นๆ","risks":["ไทยสั้นๆ"],"news":[{"headlineTh":"คำแปลไทยตามลำดับข่าว input","impact":"NEGATIVE|POSITIVE|NEUTRAL|LOW"}]}
ถ้า action ไม่ใช่ SELL_ALL ต้อง thesisBroken=false และ evidence arrays=[]

INPUT=${JSON.stringify(payload)}`

  // Output budget โตตามจำนวนหุ้น แต่ cap ไว้เพื่อรักษา Groq TPM headroom.
  const maxTokens = Math.min(2800, 800 + inputs.length * 180)
  const { text, rateLimited, usedModel } = await callGroqBatch(prompt, maxTokens)

  if (!text) {
    return {
      results: {},
      error: rateLimited ? 'RATE_LIMIT' : 'FAILED',
      usedModel: null,
      message: rateLimited ? 'Groq rate limit ระหว่าง Daily Portfolio Review' : 'Groq ไม่ตอบกลับ Daily Portfolio Review',
    }
  }

  let parsed: { analyses?: BatchAIItem[] }
  try {
    const match = text.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(match?.[0] ?? '{}') as { analyses?: BatchAIItem[] }
  } catch (error) {
    console.error('[portfolio-batch] JSON parse failed:', error)
    return { results: {}, error: 'FAILED', usedModel, message: 'AI batch response ไม่ใช่ JSON ที่สมบูรณ์' }
  }

  if (!Array.isArray(parsed.analyses)) {
    return { results: {}, error: 'FAILED', usedModel, message: 'AI batch response ไม่มี analyses array' }
  }

  const inputBySymbol = new Map(inputs.map(input => [input.holding.symbol, input]))
  const aiBySymbol = new Map<string, BatchAIItem>()
  for (const item of parsed.analyses) {
    const symbol = typeof item.symbol === 'string' ? item.symbol.toUpperCase().trim() : ''
    if (inputBySymbol.has(symbol) && !aiBySymbol.has(symbol)) aiBySymbol.set(symbol, item)
  }

  const metas = await Promise.all(inputs.map(input => getStockMeta(input.holding.symbol)))
  const results: Record<string, DetailedAnalysisResult> = {}

  inputs.forEach((input, index) => {
    const { holding, technical, earnings, news } = input
    const symbol = holding.symbol
    const item = aiBySymbol.get(symbol)
    if (!item) return

    const rawAction = typeof item.action === 'string' && (VALID_ACTIONS as readonly string[]).includes(item.action)
      ? item.action as AnalysisAction
      : null
    if (!rawAction) return

    const thesisBroken = item.thesisBroken === true
    const evidenceTypes = Array.isArray(item.sellAllEvidenceTypes)
      ? item.sellAllEvidenceTypes
          .filter((value): value is string => typeof value === 'string' && (ALLOWED_SELL_ALL_EVIDENCE_TYPES as readonly string[]).includes(value))
          .slice(0, 3)
      : []
    const evidenceText = stringArray(item.sellAllEvidence, 3, 160)

    let finalAction = rawAction
    let downgradeNote = ''
    if (rawAction === 'SELL_ALL' && !(thesisBroken && evidenceTypes.length > 0)) {
      finalAction = holding.pnl_pct != null && holding.pnl_pct > 20 ? 'SELL_PARTIAL' : 'HOLD'
      downgradeNote = `ระบบปรับ SELL_ALL เป็น ${finalAction}: ไม่มีหลักฐาน thesis-breaking เฉพาะบริษัทที่ผ่าน safeguard `
      console.warn(`[portfolio-batch] SELL_ALL downgraded ${symbol}: thesisBroken=${thesisBroken}, validEvidence=${evidenceTypes.length}`)
    }

    const aiNews = Array.isArray(item.news) ? item.news : []
    const usedNews = news.slice(0, 2).map((raw, newsIndex) => {
      const translated = aiNews[newsIndex] && typeof aiNews[newsIndex] === 'object' ? aiNews[newsIndex] as Record<string, unknown> : {}
      const impactValue = typeof translated.impact === 'string' && (VALID_NEWS_IMPACTS as readonly string[]).includes(translated.impact)
        ? translated.impact as NewsImpact
        : 'LOW'
      return {
        headline: raw.headline,
        headlineTh: trimText(translated.headlineTh, 180) || raw.headline,
        impact: impactValue,
      }
    })

    const caution = `${downgradeNote}${trimText(item.caution, 280)}`.trim()
    const summary = trimText(item.summary, 520) || `Daily Portfolio Review: ${finalAction} โดยอิงข้อมูลพอร์ตและตัวชี้วัดล่าสุด`
    const meta = metas[index]

    results[symbol] = {
      symbol,
      disclaimer: 'บทวิเคราะห์นี้สร้างโดย AI เพื่อประกอบการตัดสินใจเท่านั้น ไม่ใช่คำแนะนำการลงทุน',
      technicalSummary: technicalSummary(holding, technical),
      newsImpact: stringArray(item.newsImpact, 2, 220),
      risksAndOpportunities: {
        caution,
        opportunity: trimText(item.opportunity, 280),
      },
      recommendation: {
        action: finalAction,
        buyConditions: trimText(item.buyConditions, 280),
        sellConditions: trimText(item.sellConditions, 280),
      },
      risks: stringArray(item.risks, 2, 220),
      summary,
      analysedAt: new Date().toISOString(),
      sector: meta.sector ?? '',
      business: meta.business ?? '',
      technical,
      usedPrice: holding.current_price ?? null,
      usedNews,
      earnings,
      usedModel: usedModel ?? undefined,
      thesisBroken,
      sellAllEvidenceTypes: evidenceTypes,
      sellAllEvidence: evidenceText,
    }
  })

  return { results, error: null, usedModel }
}
