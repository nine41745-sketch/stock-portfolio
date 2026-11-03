import { isNewsRelevantToTarget } from '@/lib/news-relevance'
import { StockCheckSnapshot } from '@/lib/stock-check-data'
import { parseStockCheckAiResponse } from '@/lib/stock-check-presentation'
import { guardAiClaims, runModelChain, type ModelReply } from '@/lib/stock-check-ai-guard'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const PRIMARY_MODEL = 'openai/gpt-oss-120b'
const FALLBACK_MODEL = 'openai/gpt-oss-20b'
// Hidden reasoning tokens count toward this limit; 1400 left the JSON empty or cut off for the 120B model.
const PRIMARY_MAX_COMPLETION_TOKENS = 4000
const FALLBACK_MAX_COMPLETION_TOKENS = 2000
// Both attempts plus the news lookup must finish inside the route's 45s maxDuration.
const PRIMARY_TIMEOUT_MS = 25_000
const FALLBACK_TIMEOUT_MS = 15_000

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
  usedFallbackSummary: boolean
  removedClaims: number
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

async function callModel(model: string, prompt: string, timeoutMs: number): Promise<ModelReply> {
  try {
    return await requestModel(model, prompt, timeoutMs)
  } catch (error) {
    console.error(`[stock-check-ai] ${model} request failed:`, error instanceof Error ? error.name : 'unknown')
    return { text: '', truncated: false }
  }
}

async function requestModel(model: string, prompt: string, timeoutMs: number): Promise<ModelReply> {
  const reasoningEffort = model === PRIMARY_MODEL ? 'high' : 'medium'
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: model === PRIMARY_MODEL ? PRIMARY_MAX_COMPLETION_TOKENS : FALLBACK_MAX_COMPLETION_TOKENS,
      temperature: 0.2,
      reasoning_effort: reasoningEffort,
      reasoning_format: 'hidden',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`[stock-check-ai] Groq ${res.status} ${model}:`, text.slice(0, 180))
    return { text: '', truncated: false }
  }
  const data = await res.json()
  const choice = data.choices?.[0]
  const reply = { text: String(choice?.message?.content ?? ''), truncated: choice?.finish_reason === 'length' }
  if (!reply.text || reply.truncated) {
    console.warn(`[stock-check-ai] ${model} unusable reply: finish_reason=${choice?.finish_reason ?? 'none'} empty=${!reply.text}`)
  }
  return reply
}

// Relationships are computed here so the model never has to infer (and mis-state) them from raw numbers.
export function buildStockCheckFacts(snapshot: Pick<StockCheckSnapshot, 'price' | 'ema50' | 'ema200' | 'week52High' | 'week52Low' | 'trend'>): string[] {
  const facts: string[] = []
  const { price, ema50, ema200, week52High, week52Low } = snapshot
  if (ema50 !== null && ema200 !== null) {
    facts.push(ema50 > ema200
      ? 'EMA50 อยู่เหนือ EMA200 (โครงสร้างขาขึ้นระยะกลาง)'
      : ema50 < ema200 ? 'EMA50 อยู่ต่ำกว่า EMA200 (โครงสร้างขาลงระยะกลาง)' : 'EMA50 เท่ากับ EMA200')
  }
  if (price !== null && ema50 !== null) facts.push(price >= ema50 ? 'ราคาอยู่เหนือ EMA50' : 'ราคาอยู่ต่ำกว่า EMA50')
  if (price !== null && week52High !== null && week52High > 0) {
    const gap = ((week52High - price) / week52High) * 100
    facts.push(gap > 0.05 ? `ราคาอยู่ต่ำกว่า 52W High ${gap.toFixed(1)}%` : 'ราคาอยู่ที่หรือเหนือ 52W High')
  }
  if (price !== null && week52Low !== null && week52Low > 0) {
    facts.push(`ราคาอยู่สูงกว่า 52W Low ${(((price - week52Low) / week52Low) * 100).toFixed(1)}%`)
  }
  if (price !== null && week52High !== null && week52Low !== null && week52High > week52Low) {
    const position = ((price - week52Low) / (week52High - week52Low)) * 100
    facts.push(`ตำแหน่งของราคาในช่วง 52W คือ ${position.toFixed(0)}% (0% = ที่ 52W Low, 100% = ที่ 52W High)`)
  }
  facts.push(`Trend ที่ engine จัดประเภท: ${snapshot.trend}`)
  return facts
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
- ห้ามสรุปความสัมพันธ์ของตัวเลขเอง (EMA, ราคากับ 52W High) ให้ใช้ "ข้อเท็จจริงที่คำนวณแล้ว" ด้านล่างตามตัวอักษร
- ห้ามแนะนำให้ซื้อ ขาย หรือถือสถานะที่มีอยู่ ให้อธิบายเฉพาะผล Decision ของ engine และความเสี่ยง
- ช่อง action ให้ทวนผล Decision ของ engine เป็นข้อความสั้น (เช่น "รอย่อเข้า Entry Zone", "ยังไม่ใช่จุดซื้อ") ห้ามเพิ่มคำสั่งซื้อหรือขายใหม่

ข้อเท็จจริงที่คำนวณแล้ว:
${buildStockCheckFacts(snapshot).map(fact => `- ${fact}`).join('\n')}

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
- Earnings: ${snapshot.earnings ? `${snapshot.earnings.date} (${snapshot.earnings.daysUntil} วัน)` : 'ไม่พบนัดประกาศผลใน 60 วันข้างหน้า (ไม่ได้บอกผลประกอบการที่ผ่านมา)'}
- Entry Zone: ${p.entryZone ? `${p.entryZone.low}-${p.entryZone.high}` : 'N/A'}
- Stop: ${p.stopLoss ?? 'N/A'}
- Target1/2: ${p.target1 ?? 'N/A'} / ${p.target2 ?? 'N/A'}
- R:R at Entry: ${p.riskRewardAtEntry ?? 'N/A'}

ข่าวล่าสุด:
${newsText}

ตอบ JSON เท่านั้น:
{"summary":"สรุป 2-3 ประโยค","reasons":["เหตุผลหลัก 1","เหตุผลหลัก 2","เหตุผลหลัก 3"],"risks":["ความเสี่ยง 1","ความเสี่ยง 2"],"action":"สิ่งที่ควรทำตาม Decision เดิม 1-2 ประโยค"}`

  // Try the fallback model for any unusable reply (empty, cut off or unparseable), not only an empty one.
  const chain = await runModelChain(
    [() => callModel(PRIMARY_MODEL, prompt, PRIMARY_TIMEOUT_MS), () => callModel(FALLBACK_MODEL, prompt, FALLBACK_TIMEOUT_MS)],
    reply => !parseStockCheckAiResponse(reply, '').usedFallbackSummary,
  )
  if (!chain) throw new Error('AI_UNAVAILABLE')
  const usedModel: string | null = chain.index === 0 ? PRIMARY_MODEL : FALLBACK_MODEL

  const initial = parseStockCheckAiResponse(chain.text, p.summary)
  const { fields: guarded, removed } = guardAiClaims(initial, {
    price: snapshot.price,
    ema50: snapshot.ema50,
    ema200: snapshot.ema200,
    week52High: snapshot.week52High,
    week52Low: snapshot.week52Low,
    earningsFound: snapshot.earnings !== null,
  }, p.summary)
  if (removed > 0) console.warn(`[stock-check-ai] removed ${removed} claim(s) that contradicted computed facts (${usedModel})`)
  const parsed = { ...initial, ...guarded }

  return {
    summary: parsed.summary,
    reasons: parsed.reasons,
    risks: parsed.risks,
    action: parsed.action,
    news,
    usedModel,
    usedFallbackSummary: parsed.usedFallbackSummary,
    removedClaims: removed,
  }
}
