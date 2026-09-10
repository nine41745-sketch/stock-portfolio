import { isNewsRelevantToTarget } from '@/lib/news-relevance'
import { StockCheckSnapshot } from '@/lib/stock-check-data'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const PRIMARY_MODEL = 'openai/gpt-oss-120b'
const FALLBACK_MODEL = 'openai/gpt-oss-20b'

interface RawNews {
  headline: string
  source: string
  datetime: number
}

export interface StockCheckAiResult {
  summary: string
  reasons: string[]
  risks: string[]
  action: string
  news: RawNews[]
  usedModel: string | null
}

async function fetchRelevantNews(symbol: string): Promise<RawNews[]> {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 3)
  const fromStr = from.toISOString().split('T')[0]
  const toStr = today.toISOString().split('T')[0]

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fromStr}&to=${toStr}&token=${process.env.FINNHUB_API_KEY}`,
      { next: { revalidate: 1800 } }
    )
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data
      .filter(item => item?.headline && isNewsRelevantToTarget(item.headline, symbol))
      .slice(0, 3)
      .map(item => ({
        headline: String(item.headline),
        source: String(item.source ?? ''),
        datetime: Number(item.datetime ?? 0),
      }))
  } catch {
    return []
  }
}

async function callModel(model: string, prompt: string): Promise<string> {
  const reasoningEffort = model === PRIMARY_MODEL ? 'high' : 'medium'
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
      max_completion_tokens: 1400,
      temperature: 0.2,
      reasoning_effort: reasoningEffort,
      reasoning_format: 'hidden',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`[stock-check-ai] Groq ${res.status} ${model}:`, text.slice(0, 180))
    return ''
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

function parseJson(text: string): { summary?: unknown; reasons?: unknown; risks?: unknown; action?: unknown } | null {
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function stringArray(value: unknown, max = 4): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, max)
}

export async function analyzeStockCheckWithAi(snapshot: StockCheckSnapshot): Promise<StockCheckAiResult> {
  if (!process.env.GROQ_API_KEY) throw new Error('AI_NOT_CONFIGURED')

  const news = await fetchRelevantNews(snapshot.symbol)
  const p = snapshot.plan
  const newsText = news.length
    ? news.map((item, index) => `${index + 1}. ${item.headline} (${item.source || 'unknown'})`).join('\n')
    : 'ไม่มีข่าวสำคัญที่ผ่านตัวกรองใน 3 วันล่าสุด'

  const prompt = `คุณเป็นนักวิเคราะห์หุ้น US ระดับสถาบัน ช่วยอธิบายผล Stock Check ของ ${snapshot.symbol} เป็นภาษาไทยแบบกระชับ แม่นยำ และตรวจสอบได้

กฎสำคัญ:
- Decision, Entry Zone, Stop Loss และ Target ด้านล่างมาจาก deterministic engine ห้ามแก้ตัวเลขหรือเปลี่ยน Decision
- หน้าที่ของคุณคืออธิบายเหตุผล ตรวจความสอดคล้องของ technical + valuation + news + earnings และชี้ความเสี่ยงที่สำคัญ
- แยกให้ชัดระหว่าง "ยังไม่ใช่จุดซื้อ" กับ "ควรหลีกเลี่ยงจริง" ตาม Decision ที่ engine ให้มา
- ห้ามแต่งข้อมูลที่ไม่มีให้มา ถ้าข้อมูลไม่พอให้บอกตรงๆ
- ให้น้ำหนักข้อมูลล่าสุดและ company-specific มากกว่า macro ทั่วไป

ผล deterministic:
- Decision: ${p.decision} (${p.decisionLabel})
- Summary: ${p.summary}
- Price: ${snapshot.price ?? 'N/A'}
- Score/Setup: ${snapshot.score}/100, ${snapshot.setup}
- Trend: ${snapshot.trend}
- EMA50/EMA200: ${snapshot.ema50 ?? 'N/A'} / ${snapshot.ema200 ?? 'N/A'}
- ATR14: ${snapshot.atr14 ?? 'N/A'}
- RSI D/W: ${snapshot.rsi14 ?? 'N/A'} / ${snapshot.weeklyRsi14 ?? 'N/A'}
- MACD Histogram: ${snapshot.macdHistogram ?? 'N/A'}
- Volume Ratio: ${snapshot.volumeRatio ?? 'N/A'}
- Support/Resistance: ${snapshot.support ?? 'N/A'} / ${snapshot.resistance ?? 'N/A'}
- RS20/RS60 vs SPY: ${snapshot.relativeStrength20 ?? 'N/A'}% / ${snapshot.relativeStrength60 ?? 'N/A'}%
- 52W High/Low: ${snapshot.week52High ?? 'N/A'} / ${snapshot.week52Low ?? 'N/A'}
- P/E: ${snapshot.pe ?? 'N/A'}
- Earnings: ${snapshot.earnings ? `${snapshot.earnings.date} (${snapshot.earnings.daysUntil} วัน)` : 'ไม่พบใน 60 วัน'}
- Entry Zone: ${p.entryZone ? `${p.entryZone.low}-${p.entryZone.high}` : 'N/A'}
- Stop: ${p.stopLoss ?? 'N/A'}
- Target1/2: ${p.target1 ?? 'N/A'} / ${p.target2 ?? 'N/A'}
- R:R at Entry: ${p.riskRewardAtEntry ?? 'N/A'}

ข่าวล่าสุด:
${newsText}

ตอบ JSON เท่านั้น:
{"summary":"สรุป 2-3 ประโยค","reasons":["เหตุผลหลัก 1","เหตุผลหลัก 2","เหตุผลหลัก 3"],"risks":["ความเสี่ยง 1","ความเสี่ยง 2"],"action":"สิ่งที่ควรทำตาม Decision เดิม 1-2 ประโยค"}`

  let usedModel: string | null = PRIMARY_MODEL
  let text = await callModel(PRIMARY_MODEL, prompt)
  if (!text) {
    usedModel = FALLBACK_MODEL
    text = await callModel(FALLBACK_MODEL, prompt)
  }
  if (!text) throw new Error('AI_UNAVAILABLE')

  const parsed = parseJson(text)
  if (!parsed) {
    return {
      summary: text.slice(0, 700),
      reasons: [],
      risks: [],
      action: p.summary,
      news,
      usedModel,
    }
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : p.summary,
    reasons: stringArray(parsed.reasons),
    risks: stringArray(parsed.risks),
    action: typeof parsed.action === 'string' ? parsed.action : p.summary,
    news,
    usedModel,
  }
}
