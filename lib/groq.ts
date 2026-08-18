import { HoldingWithPrice, AnalysisResult, DetailedAnalysisResult, TechnicalSnapshot, EarningsInfo } from '@/types'
import { getStockMeta } from './stock-meta'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

// โมเดลหลัก (v1.10.7 hotfix: Groq deprecate/ปิด llama-3.3-70b-versatile แล้ว เปลี่ยนเป็น openai/gpt-oss-120b)
const GROQ_MODEL = 'openai/gpt-oss-120b'
// โมเดลสำรอง (v1.10.7 hotfix: Groq deprecate/ปิด llama-3.1-8b-instant แล้ว เปลี่ยนเป็น openai/gpt-oss-20b)
const GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b'

interface GroqCallResult {
  text: string
  rateLimited: boolean
  // 'minute' = โดน TPM/RPM รอแค่ ~1 นาทีก็หาย, 'day' = โดน TPD/RPD ต้องรอถึงวันถัดไป
  rateLimitScope: 'minute' | 'day' | null
  // โมเดลที่ตอบสำเร็จจริง (null ถ้าล้มเหลวทั้งหมด) — ใช้โชว์ transparency badge บน UI
  usedModel: string | null
}

function detectRateLimitScope(errText: string): 'minute' | 'day' | null {
  const lower = errText.toLowerCase()
  if (lower.includes('per minute')) return 'minute'
  if (lower.includes('per day')) return 'day'
  return null
}

async function callGroqWithModel(prompt: string, maxTokens: number, model: string): Promise<GroqCallResult> {
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        // v1.10.8 hotfix (GPT-OSS compatibility): โมเดลตระกูล openai/gpt-oss-* บน Groq ใช้ parameter
        // ชื่อ max_completion_tokens แทน max_tokens (ของเดิม) — ถ้ายังส่ง max_tokens ไป Groq จะปฏิเสธ/
        // ตอบ response ที่ไม่มี content กลับมา (เห็นผลเป็น groq: ❌ unknown ที่ /api/health)
        max_completion_tokens: maxTokens,
        temperature: 0.6,
        // v1.10.8 hotfix: gpt-oss เป็น reasoning model โดย default จะใส่ reasoning tokens ปนมาด้วย
        // reasoning_effort: 'low' ลด reasoning ให้น้อยที่สุดเท่าที่ยังตอบได้ถูก (ไม่กระทบ Decision
        // Framework/เนื้อหาคำตอบ — แค่ลด token ที่ใช้คิดก่อนตอบ) reasoning_format: 'hidden' ไม่ให้ reasoning
        // trace ปนเข้ามาใน content ที่เราจะเอาไป JSON.parse ต่อ (ถ้าปนมาจะพัง parse ทันที)
        reasoning_effort: 'low',
        reasoning_format: 'hidden',
      }),
    })
    if (res.status === 429) {
      const err = await res.text()
      console.error(`[Groq] Rate limited on ${model}:`, err.slice(0, 300))
      return { text: '', rateLimited: true, rateLimitScope: detectRateLimitScope(err), usedModel: null }
    }
    if (!res.ok) {
      const err = await res.text()
      console.error(`[Groq] HTTP ${res.status} on ${model}:`, err.slice(0, 200))
      return { text: '', rateLimited: false, rateLimitScope: null, usedModel: null }
    }
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    return { text, rateLimited: false, rateLimitScope: null, usedModel: text ? model : null }
  } catch (e) {
    console.error(`[Groq] Error on ${model}:`, e)
    return { text: '', rateLimited: false, rateLimitScope: null, usedModel: null }
  }
}

// เรียกโมเดลหลักก่อน ถ้าโดน rate limit ให้ fallback ไปโมเดลสำรองอัตโนมัติ
// ถ้าโมเดลสำรองก็โดนด้วย ให้คืน scope ที่ "แย่กว่า" ระหว่าง 2 ตัว (day แย่กว่า minute) ให้ข้อความแม่นยำที่สุด
async function callGroq(prompt: string, maxTokens = 1024): Promise<GroqCallResult> {
  const primary = await callGroqWithModel(prompt, maxTokens, GROQ_MODEL)
  if (primary.text) return primary

  if (primary.rateLimited) {
    console.warn(`[Groq] ${GROQ_MODEL} rate limited (${primary.rateLimitScope ?? 'unknown'}), falling back to ${GROQ_FALLBACK_MODEL}`)
    const fallback = await callGroqWithModel(prompt, maxTokens, GROQ_FALLBACK_MODEL)
    if (fallback.text) return fallback
    // ทั้งคู่โดน rate limit — ถ้าตัวใดตัวหนึ่งเป็น 'day' ให้ถือว่า worst-case คือ day
    const worstScope = primary.rateLimitScope === 'day' || fallback.rateLimitScope === 'day' ? 'day' : (primary.rateLimitScope ?? fallback.rateLimitScope)
    return { text: '', rateLimited: true, rateLimitScope: worstScope, usedModel: null }
  }

  return primary
}

export async function analyzeHolding(
  holding: HoldingWithPrice,
  cashBalance = 0,
  totalPortfolioValue = 0,
  recentNews: Array<{ headline: string }> = []
): Promise<AnalysisResult> {
  const { symbol, shares, cost_basis, current_price, pnl_pct, market_value, pe, week52High, week52Low } = holding

  const cashRatioPct = totalPortfolioValue > 0
    ? ((cashBalance / (totalPortfolioValue + cashBalance)) * 100).toFixed(1)
    : '0'
  const canBuyShares = current_price && current_price > 0 ? Math.floor(cashBalance / current_price) : 0

  const metricsInfo = [
    pe         != null ? `P/E: ${pe.toFixed(1)}` : null,
    week52High != null ? `52W High: $${week52High.toFixed(2)}` : null,
    week52Low  != null ? `52W Low: $${week52Low.toFixed(2)}`   : null,
  ].filter(Boolean).join(', ')

  const newsSnippet = recentNews.slice(0, 3).map((n, i) => `${i + 1}. ${n.headline}`).join('\n') || 'none'

  const prompt = `คุณเป็นนักวิเคราะห์หุ้น US มืออาชีพ วิเคราะห์หุ้น ${symbol}

ข้อมูล:
- ราคา: $${current_price?.toFixed(2) ?? 'N/A'}, ต้นทุน: ${cost_basis ? `$${cost_basis.toFixed(2)}` : 'N/A'}, จำนวน: ${shares} หุ้น
- มูลค่า: ${market_value ? `$${market_value.toFixed(2)}` : 'N/A'}, กำไร/ขาดทุน: ${pnl_pct != null ? `${pnl_pct > 0 ? '+' : ''}${pnl_pct.toFixed(1)}%` : 'N/A'}
- Metrics: ${metricsInfo || 'ไม่มีข้อมูล'}
- เงินสด: $${cashBalance.toFixed(2)} (ซื้อเพิ่มได้ ~${canBuyShares} หุ้น), สัดส่วนเงินสด: ${cashRatioPct}%
- ข่าว: ${newsSnippet}

เลือกสัญญาณ: BUY (พื้นฐานดี ราคาน่าซื้อ) / HOLD (สมดุลดี) / SELL_PARTIAL (lock กำไรบางส่วน) / SELL_ALL (cut loss หรือพื้นฐานแย่ลง)
ฟันธงชัดเจน ห้ามเลี่ยงไป HOLD ถ้าข้อมูลบ่งชี้ว่าควรขาย เช่น กำไรสูงมากควร lock กำไรบางส่วน (SELL_PARTIAL) หรือขาดทุนหนัก/พื้นฐานแย่ลงควร cut loss (SELL_ALL)

ตอบเป็น JSON เท่านั้น ทุกข้อความเป็นภาษาไทย กระชับ:
{"signal":"BUY|HOLD|SELL_PARTIAL|SELL_ALL","summary":"สรุป 1-2 ประโยค","reasons":["เหตุผล1","เหตุผล2","เหตุผล3"],"detail":"อธิบาย 2-3 ประโยคสั้นๆ","action":"คำแนะนำปฏิบัติชัดเจน","sector":"อุตสาหกรรม","business":"ลักษณะธุรกิจ 1 ประโยค","targetCustomers":"กลุ่มลูกค้าหลัก"}`

  const validSignals = ['BUY', 'HOLD', 'SELL_PARTIAL', 'SELL_ALL']

  // ดึง signal ตรงๆ ด้วย regex ก่อน กันกรณี JSON ถูกตัดกลางคันจาก token limit
  // ทำให้ยังได้ signal ที่ถูกต้อง แม้ field อื่นจะ parse ไม่ได้ครบ
  function extractSignal(raw: string): AnalysisResult['signal'] {
    const m = raw.match(/"signal"\s*:\s*"(BUY|HOLD|SELL_PARTIAL|SELL_ALL)"/)
    return (m && validSignals.includes(m[1]) ? m[1] : 'HOLD') as AnalysisResult['signal']
  }

  try {
    const { text } = await callGroq(prompt, 1500)
    const fallbackSignal = extractSignal(text)
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{}')
    return {
      symbol,
      signal: (validSignals.includes(parsed.signal) ? parsed.signal : fallbackSignal) as AnalysisResult['signal'],
      summary: parsed.summary ?? '',
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      detail: parsed.detail ?? '',
      action: parsed.action ?? '',
      sector: parsed.sector ?? '',
      business: parsed.business ?? '',
      targetCustomers: parsed.targetCustomers ?? '',
    }
  } catch {
    return { symbol, signal: 'HOLD', summary: '', reasons: [], detail: '', action: '' }
  }
}

// v1.12.0 (Portfolio-Aware Decision Framework): สรุปสัดส่วน (%) ของหุ้นตัวอื่นๆ ในพอร์ต (ไม่รวมตัวที่
// กำลังวิเคราะห์) เทียบกับมูลค่าพอร์ตหุ้นรวม — ให้ AI เห็นภาพรวมการกระจายพอร์ตทั้งก้อน (concentration/
// correlated exposure) แทนที่จะเห็นแค่หุ้นตัวเดียวโดดๆ เป็น pure function รับ array ทั่วไป ไม่ผูกกับ
// ticker ใดเลย ใช้ได้กับหุ้นปัจจุบัน/อนาคตทุกตัวอัตโนมัติ ไม่ต้องเพิ่ม hardcode ทีละตัว
// คืน [] ถ้า totalPortfolioValue คำนวณไม่ได้ (null/0) — เรียกใช้จุดที่เรียกต้องแสดง "N/A/ไม่ครบ" เอง
// ไม่ใช่หน้าที่ฟังก์ชันนี้เดา
export function summarizeOtherHoldings(
  targetSymbol: string,
  allHoldings: Array<{ symbol: string; marketValue: number | null }>,
  totalPortfolioValue: number | null
): Array<{ symbol: string; weightPct: number }> {
  if (totalPortfolioValue === null || totalPortfolioValue <= 0) return []
  return allHoldings
    .filter(h => h.symbol !== targetSymbol && h.marketValue != null)
    .map(h => ({ symbol: h.symbol, weightPct: ((h.marketValue as number) / totalPortfolioValue) * 100 }))
    .sort((a, b) => b.weightPct - a.weightPct)
}

export async function analyzeHoldingDetailed(
  holding: HoldingWithPrice,
  technical: TechnicalSnapshot,
  cashBalance = 0,
  // final review v1.10.3: totalPortfolioValue รับ null ได้ เพื่อสื่อความหมาย "คำนวณไม่ได้ เพราะราคา
  // หุ้นบางตัวในพอร์ตหาไม่ได้" แยกจาก 0 ที่แปลว่า "พอร์ตมีมูลค่าหุ้นจริงๆ เป็น 0" (มีแต่เงินสด) — ไม่ใช่
  // การแก้ Decision Framework แค่แก้ semantic ของบรรทัดข้อมูลสภาพคล่องที่ AI อ่าน ค่า default ยังเป็น 0
  // เหมือนเดิม (backward compatible กับ cron ที่ยังส่ง number ล้วนๆ อยู่)
  totalPortfolioValue: number | null = 0,
  recentNews: Array<{ headline: string; headlineTh?: string; impact?: string }> = [],
  earnings: EarningsInfo | null = null,
  // v1.12.0 (Portfolio-Aware Decision Framework): หุ้นอื่นในพอร์ต + สัดส่วน — default [] เพื่อ backward
  // compatible กับจุดเรียกเก่าที่ยังไม่ได้ส่งมา (ไม่มี ก็แค่ได้ portfolio context ที่ไม่มีข้อมูลหุ้นอื่น
  // ไม่ error)
  otherHoldings: Array<{ symbol: string; weightPct: number }> = []
): Promise<DetailedAnalysisResult> {
  const { symbol, shares, cost_basis, current_price, pnl_pct, market_value, pe, week52High, week52Low } = holding

  // v1.12.0 (Portfolio-Aware Decision Framework): สัดส่วนของหุ้นตัวนี้เทียบกับมูลค่าพอร์ตหุ้นรวม (ไม่รวม
  // เงินสด) — null แปลว่า "ไม่ทราบ/คำนวณไม่ได้" (portfolio context incomplete) เช่นเดียวกับ cashRatioPct
  // ด้านล่าง ไม่ใช่ 0% จริงๆ
  const positionWeightPct: string | null = totalPortfolioValue !== null && totalPortfolioValue > 0 && market_value !== null
    ? ((market_value / totalPortfolioValue) * 100).toFixed(1)
    : null

  // cashRatioPct = null หมายถึง "ไม่ทราบ/คำนวณไม่ได้" (portfolio valuation incomplete) ต่างจาก '0'
  // ที่หมายถึง "คำนวณได้แล้วได้ 0%" (พฤติกรรมเดิมตอน totalPortfolioValue===0 ยังคงเหมือนเดิมทุกประการ)
  const cashRatioPct: string | null = totalPortfolioValue !== null && totalPortfolioValue > 0
    ? ((cashBalance / (totalPortfolioValue + cashBalance)) * 100).toFixed(1)
    : (totalPortfolioValue === null ? null : '0')

  const metricsInfo = [
    pe         != null ? `P/E: ${pe.toFixed(1)}` : null,
    week52High != null ? `52W High: $${week52High.toFixed(2)}` : null,
    week52Low  != null ? `52W Low: $${week52Low.toFixed(2)}`   : null,
  ].filter(Boolean).join(', ')

  // สรุป technical indicators เป็นข้อความให้ AI อ่าน (รวม support/resistance/volume ที่คำนวณจริงแล้ว
  // เพื่อบังคับให้ AI ใช้ตัวเลขจริงแทนการเดาราคาเอง)
  const techLines = [
    technical.ema50  != null ? `EMA50: $${technical.ema50}`   : null,
    technical.ema100 != null ? `EMA100: $${technical.ema100}` : null,
    technical.ema200 != null ? `EMA200: $${technical.ema200}` : null,
    technical.rsi14   != null ? `RSI(14) รายวัน: ${technical.rsi14}` : null,
    technical.weeklyRsi14 != null ? `RSI(14) รายสัปดาห์: ${technical.weeklyRsi14} (ภาพใหญ่ระยะยาว — ใช้เช็คว่าโซน overbought/oversold รายวันเป็นแค่ความผันผวนระยะสั้นหรือสอดคล้องกับแนวโน้มใหญ่จริง)` : null,
    technical.macd.macd != null ? `MACD: ${technical.macd.macd} / Signal: ${technical.macd.signal} / Histogram: ${technical.macd.histogram}` : null,
    technical.bollinger.upper != null ? `Bollinger Bands: บน $${technical.bollinger.upper} / กลาง $${technical.bollinger.middle} / ล่าง $${technical.bollinger.lower}` : null,
    technical.support    != null ? `แนวรับ (Support, 20-day swing low): $${technical.support}` : null,
    technical.resistance != null ? `แนวต้าน (Resistance, 20-day swing high): $${technical.resistance}` : null,
    technical.volumeRatio != null ? `Volume Ratio (วันล่าสุด/เฉลี่ย 20 วัน): ${technical.volumeRatio}x${technical.volumeRatio > 1.5 ? ' (สูงผิดปกติ — มีแรงซื้อ/ขายหนาแน่น)' : ''}` : null,
    `แนวโน้มราคา (EMA cross): ${technical.trend}`,
  ].filter(Boolean).join('\n')

  const newsSnippet = recentNews.slice(0, 5)
    .map((n, i) => `${i + 1}. ${n.headlineTh ?? n.headline}${n.impact ? ` [${n.impact}]` : ''}`)
    .join('\n') || 'ไม่มีข่าวล่าสุด'

  const earningsLine = earnings
    ? `⚠️ หุ้นนี้จะประกาศผลประกอบการในอีก ${earnings.daysUntil} วัน (${earnings.date}${earnings.hour ? `, ${earnings.hour}` : ''}) — ราคาอาจเหวี่ยงแรงจากงบ ทำให้ technical indicators ใช้ทำนายไม่ได้แม่นยำช่วงนี้`
    : 'ไม่มีข้อมูลวันประกาศงบในอีก 60 วันข้างหน้า'

  // v1.12.0 (Portfolio-Aware Decision Framework): สรุปหุ้นอื่นในพอร์ตเป็นข้อความให้ AI อ่าน — ตัดที่ 8
  // ตัวแรก (เรียงสัดส่วนมากไปน้อยจาก summarizeOtherHoldings) กันพรอมต์ยาวเกินไปในพอร์ตที่มีหุ้นเยอะมาก
  // ตัวที่เหลือสรุปเป็นจำนวนรวมแทนไม่ทิ้งข้อมูลไปเฉยๆ — generic ล้วนๆ ทำงานกับหุ้นกี่ตัวก็ได้อัตโนมัติ
  const OTHER_HOLDINGS_SHOWN = 8
  const otherHoldingsLine = otherHoldings.length === 0
    ? (totalPortfolioValue === null ? 'N/A — ไม่สามารถคำนวณได้ เนื่องจากราคาหุ้นบางตัวในพอร์ตไม่พร้อม (portfolio context incomplete)' : 'ไม่มีหุ้นอื่นในพอร์ต (ถือตัวนี้ตัวเดียว)')
    : [
        otherHoldings.slice(0, OTHER_HOLDINGS_SHOWN).map(h => `${h.symbol} (${h.weightPct.toFixed(1)}%)`).join(', '),
        otherHoldings.length > OTHER_HOLDINGS_SHOWN ? `และอีก ${otherHoldings.length - OTHER_HOLDINGS_SHOWN} ตัว` : null,
      ].filter(Boolean).join(' ')

  // v1.12.0 (Portfolio-Aware Decision Framework): ย้าย "summary" มาไว้เป็น field ที่ 4 ในสคีมา (ต่อจาก
  // technicalSummary) จากเดิมที่อยู่ท้ายสุด — เพราะตอนนี้ summary ต้องแบกรับเนื้อหาสำคัญเพิ่มขึ้นมาก
  // (fundamental/valuation/portfolio impact/เหตุผล) เสี่ยงโดนตัดทิ้งถ้า Groq token หมดกลางคันตอนอยู่
  // ท้ายสุดแบบเดิม ย้ายมาไว้ต้นๆ คู่กับ technicalSummary ที่ required อยู่แล้ว ให้ทั้งสอง field สำคัญนี้
  // รอดจาก truncation ได้มากขึ้น ("action" ยังคงเป็น key แรกสุดเหมือนเดิมทุกประการ ไม่กระทบ regex
  // recovery ที่มีอยู่)
  const prompt = `คุณเป็นนักวิเคราะห์การลงทุนระดับสถาบัน (Institutional Portfolio Manager) ประเมินหุ้น ${symbol} อย่างเป็นกลาง ปราศจาก Bias
ต้องตัดสินใจโดยพิจารณาหลายมิติร่วมกันเสมอ (fundamentals, valuation, เทคนิคัล, ข่าวเฉพาะบริษัท, ข่าว sector/macro ภาพรวม, ต้นทุนผู้ใช้, กำไร/ขาดทุนปัจจุบัน, ขนาดโพซิชัน/สัดส่วนในพอร์ต, มูลค่าพอร์ตรวม, เงินสดคงเหลือ, ความเข้มข้นของพอร์ต, risk/reward และ downside, business thesis ระยะยาว) ห้ามใช้ตัวชี้วัดเทคนิคัลเพียงตัวเดียวเป็นตัวตัดสิน action เด็ดขาด

=== สถานะพอร์ตและปัจจัยแวดล้อม ===
- ราคาปัจจุบัน: $${current_price?.toFixed(2) ?? 'N/A'} (ต้นทุน: ${cost_basis ? `$${cost_basis.toFixed(2)}` : 'N/A'}, ถืออยู่: ${shares} หุ้น)
- สถานะ P&L ปัจจุบัน: ${pnl_pct != null ? `${pnl_pct > 0 ? '+' : ''}${pnl_pct.toFixed(1)}%` : 'N/A'} (มูลค่า: ${market_value ? `$${market_value.toFixed(2)}` : 'N/A'})
- Valuation/Metrics: ${metricsInfo || 'ไม่มีข้อมูล'} (⚠️ P/E ที่ให้มาเป็นค่า trailing/normalized เท่านั้น ไม่มี forward P/E และไม่มี timestamp ความสดใหม่ของข้อมูลกำกับ — ห้ามสรุปว่าหุ้น "แพง/ถูก" จาก P/E ตัวเดียวถ้าไม่มีข้อมูลอื่นสนับสนุนพอ ให้ระบุว่า valuation confidence ต่ำแทน ห้ามสร้างตัวเลขขึ้นเอง)
- สถานะสภาพคล่อง: เงินสดสำรอง $${cashBalance.toFixed(2)} (${cashRatioPct === null ? 'N/A — ไม่สามารถคำนวณสัดส่วนเงินสดได้ เนื่องจากราคาหุ้นบางตัวในพอร์ตไม่พร้อม' : `${cashRatioPct}% ของพอร์ต`}) — เป็นข้อมูลอ้างอิงเท่านั้น ไม่ใช่เหตุผลในการแนะนำซื้อ

=== บริบทพอร์ตทั้งหมด (Portfolio-Wide Context) ===
- มูลค่าพอร์ตหุ้นรวม (ไม่รวมเงินสด): ${totalPortfolioValue === null ? 'N/A — portfolio context incomplete (ราคาหุ้นบางตัวในพอร์ตไม่พร้อม ห้ามเดาตัวเลข)' : `$${totalPortfolioValue.toFixed(2)}`}
- สัดส่วนหุ้นนี้ในพอร์ต (Position Weight): ${positionWeightPct === null ? 'N/A — portfolio context incomplete' : `${positionWeightPct}% ของมูลค่าพอร์ตหุ้นรวม`}
- หุ้นอื่นในพอร์ต: ${otherHoldingsLine}

=== ตัวชี้วัดทางเทคนิค (Technical Indicators) ===
${techLines || 'ไม่มีข้อมูลเทคนิค'}

=== ปฏิทินผลประกอบการ (Earnings Calendar) ===
${earningsLine}

=== ข่าวสารและปัจจัยกระทบล่าสุด ===
${newsSnippet}

=== เกณฑ์ประเมินสัญญาณ (DECISION FRAMEWORK) ===
เช็กตามลำดับข้อ 0 -> 1 -> 2 -> 3 -> 4 จากบนลงล่าง แต่ละข้อมีเงื่อนไขย่อยหลายข้อเชื่อมด้วย "หรือ" (OR) เสมอ (ยกเว้นข้อ 1 SELL_ALL ที่เข้มงวดกว่าข้ออื่นตามที่ระบุในข้อนั้น)
กติกาสำคัญที่สุด: แค่เงื่อนไขย่อยข้อเดียวเป็นจริงก็เพียงพอให้เลือก action นั้นได้ทันที ห้ามหาเหตุผลอื่นมา "หักล้าง" หรือ "รอเงื่อนไขอื่นมายืนยันเพิ่ม" ก่อนตัดสินใจ (เช่น P&L เกินเกณฑ์แล้วแต่ RSI ยังไม่ยืนยัน ก็ต้องเลือกตามเกณฑ์ P&L ไปเลย ไม่ต้องรอ RSI)
กติกาสำคัญอีกข้อ: ถ้าข้อมูลบริบทพอร์ต (มูลค่าพอร์ตรวม/สัดส่วนหุ้นนี้ในพอร์ต) เป็น N/A ห้ามเดาตัวเลขหรือสมมติค่าขึ้นเองเด็ดขาด ให้ระบุตรงๆ ว่า portfolio context ไม่ครบ แล้วใช้ข้อมูลส่วนที่มีอยู่จริง (ราคา/ต้นทุน/เทคนิคัล/ข่าว) ตัดสินใจแทน

0. ถ้าใกล้ประกาศงบภายใน 7 วัน — ยกระดับความเสี่ยงเป็น High Risk เสมอ ไม่ว่า action จะเป็นอะไร ต้องเตือนใน "caution" อย่างชัดเจนว่าใกล้ประกาศงบ ราคาอาจเหวี่ยงแรงเกินคาดจาก technical signal และควรพิจารณาลดขนาดโพซิชันหรือรอดูงบก่อนตัดสินใจซื้อเพิ่ม

1. SELL_ALL (ขายทั้งหมด) — เป็น action ที่มี threshold สูงที่สุด ใช้เฉพาะเมื่อมีหลักฐานว่า business thesis ของหุ้นนี้ "เสียหายอย่างมีนัยสำคัญ" เท่านั้น
   ห้ามเลือก SELL_ALL เพียงเพราะเงื่อนไขต่อไปนี้ลำพัง ไม่ว่าจะรุนแรงแค่ไหนก็ตาม ถ้าไม่มีหลักฐาน thesis-breaking ตามรายการด้านล่างร่วมด้วย:
   - ราคาต่ำกว่า EMA200 (ลำพัง)
   - EMA50/EMA100/EMA200 เรียงตัวเป็นขาลง (bearish alignment)
   - MACD ติดลบ
   - RSI อ่อนแอ/oversold
   - แนวโน้มราคาเป็นขาลง (downtrend) ลำพัง
   - ข่าวลบภาพรวมตลาด/ETF/sector ทั่วไปที่ไม่ได้เจาะจงบริษัทนี้โดยตรง
   - การขาดทุนที่ยังไม่รับรู้ (unrealized loss/P&L ติดลบ) ของผู้ใช้ลำพัง ไม่ว่าจะติดลบมากแค่ไหน
   เข้าเกณฑ์ SELL_ALL ได้ก็ต่อเมื่อมีหลักฐานอย่างน้อยหนึ่งข้อต่อไปนี้ ที่มีนัยสำคัญและเจาะจงต่อบริษัทนี้จริง (ไม่ใช่ภาพรวมตลาด):
   (ก) business thesis เดิมเสียหายอย่างมีสาระสำคัญ (เช่น ผลิตภัณฑ์/บริการหลักเสียส่วนแบ่งตลาดถาวร ไม่ใช่แค่ผลประกอบการรายไตรมาสแย่ลง)
   (ข) fundamentals เสื่อมถอยรุนแรงเฉพาะบริษัท ที่มีหลักฐานจากข่าว/ข้อมูลจริง (ไม่ใช่แค่การตีความจากราคาหุ้นที่ลง)
   (ค) ข่าว fraud / ปัญหาบัญชี / governance ที่มีผลกระทบรุนแรงต่อบริษัท
   (ง) ความเสี่ยงด้านสภาพคล่อง/ความสามารถชำระหนี้ (solvency/liquidity risk) ที่มีนัยสำคัญ
   (จ) สูญเสียความสามารถแข่งขันเชิงโครงสร้างอย่างรุนแรง (structural competitive loss)
   (ฉ) เหตุการณ์กฎหมาย/กำกับดูแล (regulatory/legal) ที่กระทบธุรกิจหลักอย่างหนัก
   (ช) ความเสี่ยงระดับสูงอื่นที่มีหลักฐานชัดเจนเทียบเท่าข้อ (ก)-(ฉ) ข้างต้น
   ถ้าไม่เข้าเงื่อนไข (ก)-(ช) แม้แต่ข้อเดียว ห้ามเลือก SELL_ALL เด็ดขาด ไม่ว่า technical/P&L จะแย่แค่ไหนก็ตาม — ให้ปัจจัยเทคนิคัลที่อ่อนแอมีผลต่อ "จังหวะ/ขนาดโพซิชัน" (timing/position sizing) แทน โดย action ที่เลือกได้ยังคงเป็นหนึ่งใน 4 ค่าเดิมเท่านั้น (BUY/HOLD/SELL_PARTIAL/SELL_ALL) — ใช้ HOLD ถ้า thesis ยังดีและยังไม่อยากทำอะไรตอนนี้, ใช้ BUY พร้อมระบุใน "buyConditions" ว่าควรทยอยซื้อทีละน้อย (DCA) แทนซื้อเต็มจำนวนถ้าจะเข้าซื้อเพิ่ม, หรือใช้ SELL_PARTIAL ถ้าต้องการลดความเสี่ยงบางส่วนไว้ก่อน — ห้ามสร้าง action ค่าใหม่ที่ไม่อยู่ใน 4 ค่านี้เด็ดขาด (เช่น "WAIT" หรือ "BUY_SMALL" ไม่ใช่ action ที่ถูกต้อง)
   ตัวอย่าง: P&L -23% และแนวโน้ม DOWNTREND ชัดเจน ราคาต่ำกว่า EMA200 แต่ไม่มีข่าว fundamentals เสีย/fraud/solvency/regulatory ใดๆ เลย — ห้ามเลือก SELL_ALL เพียงเพราะ P&L หรือแนวโน้มเทคนิคัล ให้พิจารณา HOLD (ถ้าเชื่อว่า thesis ระยะยาวยังดีอยู่) หรือ SELL_PARTIAL (ถ้าต้องการลดความเสี่ยง/คืนทุนบางส่วนก่อน) แทน พร้อมอธิบายความขัดแย้งระหว่างเทคนิคัลที่อ่อนแอกับพื้นฐานที่ยังไม่เสียให้ผู้ใช้เข้าใจตรงๆ
   สำคัญมาก (structured evidence — ระบบจะตรวจสอบค่านี้แยกจาก action โดยอัตโนมัติ): ทุกครั้งที่ตอบต้องใส่ "thesisBroken" (boolean), "sellAllEvidenceTypes" (array ของ enum string) และ "sellAllEvidence" (array ของ string อธิบายเพิ่มเติม) เสมอ ไม่ว่า action จะเป็นอะไร
   ถ้าเลือก action เป็น SELL_ALL ให้ thesisBroken เป็น true และใส่ sellAllEvidenceTypes อย่างน้อย 1 ค่า โดยแต่ละค่าต้องเป็นหนึ่งใน enum ที่อนุญาตเท่านั้น (ห้ามสร้างค่าอื่นนอกเหนือจากนี้เด็ดขาด):
   "FUNDAMENTAL_DETERIORATION" (พื้นฐานธุรกิจเสียหายมีสาระสำคัญ), "FRAUD_GOVERNANCE" (ทุจริต/governance), "SOLVENCY_LIQUIDITY" (ความเสี่ยงสภาพคล่อง/ล้มละลาย), "STRUCTURAL_COMPETITIVE_LOSS" (สูญเสียความสามารถแข่งขันเชิงโครงสร้าง), "SEVERE_REGULATORY_LEGAL" (ปัญหากฎหมาย/กำกับดูแลรุนแรง), "BUSINESS_MODEL_IMPAIRMENT" (โมเดลธุรกิจเสียหาย), "OTHER_PERMANENT_IMPAIRMENT" (ความเสียหายถาวรเฉพาะบริษัทอื่นๆ ที่ไม่เข้าหมวดข้างต้นแต่ยังเป็น thesis-breaking จริง)
   ห้ามใส่ enum ค่าใดๆ ที่สื่อถึงเทคนิคัล (EMA/MACD/RSI/downtrend), unrealized loss/P&L, หรือข่าวภาพรวมตลาด/macro/ETF/sector เด็ดขาด — ไม่มี enum สำหรับสิ่งเหล่านี้ในรายการที่อนุญาตเลย ถ้าเหตุผลที่แท้จริงเป็นแค่เทคนิคัลหรือภาพรวมตลาด ห้ามเลือก SELL_ALL ตั้งแต่แรก (ดูข้อ 1 ด้านบน)
   ใส่ sellAllEvidence (string) เพิ่มเติมเพื่ออธิบายรายละเอียดของแต่ละ evidence type เป็นภาษาที่อ่านเข้าใจได้ (เช่น "(ค) พบข่าวปัญหาบัญชี/governance ที่กระทบบริษัทโดยตรง") แต่ field นี้เป็นแค่คำอธิบายประกอบเท่านั้น ระบบฝั่ง server ใช้ sellAllEvidenceTypes เป็นตัวตัดสินหลัก ไม่ใช้ sellAllEvidence แบบ free-text ในการอนุมัติ SELL_ALL
   ถ้า action ไม่ใช่ SELL_ALL ให้ thesisBroken เป็น false, sellAllEvidenceTypes และ sellAllEvidence เป็น array ว่าง [] เสมอ ห้ามใส่ thesisBroken=true โดยไม่มี sellAllEvidenceTypes ที่ถูกต้องรองรับ — ระบบฝั่ง server จะปฏิเสธ SELL_ALL ที่ไม่ผ่านเงื่อนไขนี้โดยอัตโนมัติไม่ว่า action ที่ตอบมาจะเป็นอะไรก็ตาม


2. SELL_PARTIAL (ขายล็อกกำไรบางส่วน / ลดความเสี่ยงบางส่วน) — เข้าเกณฑ์ทันทีถ้ามีข้อใดข้อหนึ่งต่อไปนี้เป็นจริง:
   (ก) P&L เกิน +20% ขึ้นไป
   (ข) RSI(14) รายวัน > 70 (Overbought)
   (ค) ราคาปัจจุบัน "ทะลุ" แนวต้านสำคัญไปแล้ว (Current Price > Resistance หรือ > 52W High หรือ > BB Upper ที่ให้มา) และ P&L เป็นบวกเกิน +15% ขึ้นไป
       ห้ามตีความการทะลุแนวต้านแบบนี้เป็นสัญญาณ bullish breakout ที่ต้องถือต่อ — ให้ถือว่าราคาวิ่งเกินเป้าหมายระยะสั้นแล้ว ต้องเลือก SELL_PARTIAL เพื่อทยอยล็อกกำไร แม้ RSI จะยังไม่เกิน 70 ก็ตาม
       ข้อยกเว้น (ยังไม่เข้าเกณฑ์นี้): ถ้าราคาปัจจุบันยังต่ำกว่าหรือเท่ากับแนวต้าน (แค่กำลังเข้าใกล้/ทดสอบแนวต้าน ยังไม่ทะลุ) ให้ถือว่ายังไม่เข้าเงื่อนไขข้อนี้ ไปประเมินเงื่อนไขอื่นแทน
   (ง) fundamentals เริ่มเสื่อมถอยจริง (มีหลักฐานจากข่าว) แต่ยังไม่ถึงขั้น thesis-breaking ตามเกณฑ์ SELL_ALL ข้อ 1 — ใช้ SELL_PARTIAL เพื่อลดความเสี่ยงบางส่วนไว้ก่อน แทนที่จะถือเต็มจำนวนหรือขายทั้งหมดทันที
   ตัวอย่าง 1: P&L +66% แต่ RSI รายวันแค่ 60 (ยังไม่ overbought) ก็ต้องเลือก SELL_PARTIAL ทันที เพราะเข้าเงื่อนไข (ก) แล้ว ไม่ต้องรอ RSI ยืนยันเพิ่ม
   ตัวอย่าง 2: ราคาปัจจุบัน $124.89 แนวต้านที่คำนวณไว้ $120 (ราคาทะลุแนวต้านไปแล้ว) P&L +19.57% RSI รายวัน 61 (ยังไม่ overbought) — ต้องเลือก SELL_PARTIAL ทันที เพราะราคาทะลุแนวต้านไปแล้วและ P&L เกิน +15% เข้าเงื่อนไข (ค) ห้ามใช้เหตุผล "แนวโน้ม SIDEWAYS" หรือ "ยังไม่มีข่าวลบ" มาหักล้างแล้วเลือก HOLD แทน
   ตัวเสริมความมั่นใจ (ไม่ใช่เงื่อนไขบังคับ): ถ้า RSI(14) รายสัปดาห์ overbought (>70) ร่วมด้วย หรือ Volume Ratio สูงผิดปกติร่วมด้วย ให้ระบุใน technicalSummary ว่ายิ่งน่าเชื่อว่าเป็นจุดพีคจริง

3. BUY (ซื้อเพิ่ม) — เข้าเกณฑ์ถ้ามีข้อใดข้อหนึ่งต่อไปนี้เป็นจริง และยังไม่เข้าเกณฑ์ SELL_PARTIAL ข้างต้น และไม่ใกล้ประกาศงบภายใน 7 วัน และข่าวสารส่วนใหญ่ไม่เป็นลบรุนแรง:
   (ก) แนวโน้มเป็น UPTREND
   (ข) RSI(14) รายวัน < 45 (โซนสะสม)
   (ค) ราคาใกล้/ต่ำกว่าแนวรับ (Support)
   ตัวเสริมความมั่นใจ (ไม่ใช่เงื่อนไขบังคับ): ถ้า RSI(14) รายสัปดาห์ยังไม่ oversold (ยังสูงกว่า 45) ระหว่างที่ RSI รายวัน oversold — แปลว่าเป็นแค่การย่อตัวระยะสั้นในเทรนด์ใหญ่ที่ยังแข็งแรง ให้ระบุว่าสัญญาณซื้อน่าเชื่อถือกว่า แต่ถ้า RSI รายสัปดาห์ก็ oversold ด้วย ให้เตือนว่าอาจเป็นเทรนด์ขาลงใหญ่ ไม่ใช่แค่ย่อตัว
   ก่อนสรุป BUY ต้องพิจารณาบริบทพอร์ตด้วยเสมอ (portfolio-aware sizing):
   - ถ้าสัดส่วนหุ้นนี้ในพอร์ต (Position Weight) สูงอยู่แล้ว (เช่นเกิน ~25-30% ของมูลค่าพอร์ตหุ้นรวม) ห้ามแนะนำซื้อเพิ่มแบบไม่สนใจ concentration — ให้เตือนเรื่อง concentration risk ใน "caution" เสมอ และถ้ายังเลือก action เป็น BUY ให้ระบุใน "buyConditions" ว่าควรซื้อขนาดเล็กมากหรือรอให้สัดส่วนลดลงก่อน แทนการแนะนำซื้อเต็มจำนวนตามสัญญาณเทคนิคัลเพียงอย่างเดียว หรือพิจารณาเปลี่ยนเป็น HOLD แทนก็ได้ถ้า concentration สูงมากจนไม่ควรซื้อเพิ่มเลย
   - ถ้าเงินสดคงเหลือต่ำเทียบกับมูลค่าพอร์ต ให้ระบุข้อจำกัดเรื่องเงินสดชัดเจนใน "buyConditions" (เช่น เงื่อนไขซื้อเมื่อมีเงินสดเพิ่ม หรือซื้อได้จำกัดกี่หุ้น) แทนที่จะแนะนำซื้อเกินกำลังเงินสดที่มี
   - ถ้า Position Weight เป็น N/A (portfolio context ไม่ครบ) ห้ามเดาว่าโพซิชันใหญ่หรือเล็ก ให้ระบุว่าไม่สามารถประเมิน concentration ได้ตรงๆ

4. HOLD (ถือต่อ) — ใช้ได้เฉพาะเมื่อเช็กครบข้อ 1-3 แล้วจริงๆ ว่าไม่เข้าเงื่อนไขย่อยข้อไหนเลยแม้แต่ข้อเดียว เช่น RSI(14) รายวันอยู่กลางแท้ๆ (45-60) และ P&L อยู่ระหว่าง -15% ถึง +20% และราคาไม่ชนแนวรับ/แนวต้าน และไม่มีข่าวสำคัญ หรือกรณีเทคนิคัลอ่อนแอแต่ fundamentals/thesis ยังไม่เสียตามที่อธิบายในข้อ 1

ห้ามเลือก BUY แค่เพราะมีเงินสดเหลือเยอะ ต้องมีเหตุผลด้านเทคนิคัล/ข่าว/fundamentals รองรับเสมอ
ห้ามเลือก HOLD เป็นค่าปลอดภัยเริ่มต้น — ต้องเช็คเงื่อนไขย่อยทุกข้อของ SELL_ALL, SELL_PARTIAL, BUY ก่อนเสมอทีละข้อ เลือก HOLD ได้ก็ต่อเมื่อไม่เข้าเงื่อนไขย่อยข้อใดเลยจริงๆ เท่านั้น
ถ้า technical indicators คำนวณไม่ได้ (ข้อมูลไม่พอ) ให้ใช้ fundamentals (P/E, 52W High/Low) และข่าวแทนในการตัดสินใจ ไม่ใช่รีบเลือก HOLD เพราะขาดข้อมูล

=== การจำแนกข่าว (News Classification) ===
ข่าวแต่ละชิ้นด้านบนต้องจำแนกว่าเป็นข่าวเฉพาะบริษัทนี้ (company-specific) หรือข่าวภาพรวม sector/ตลาดทั่วไป (macro/broad-market) ก่อนนำไปใช้ประกอบการตัดสินใจ
ข่าวภาพรวมตลาด/ETF/sector ทั่วไปที่ไม่ได้เจาะจงบริษัทนี้โดยตรง ห้ามตีความเป็นเหตุการณ์ลบร้ายแรงเฉพาะบริษัท (severe company-specific negative event) เด็ดขาด
ข่าวที่จะมีน้ำหนักผลักไปทาง SELL_ALL (ตามเงื่อนไข (ก)-(ช) ในข้อ 1) ต้องมีความเกี่ยวข้อง (relevance) และความรุนแรง (severity) ต่อบริษัทเป้าหมายจริงเท่านั้น

สำคัญมากเรื่องราคา: "buyConditions" และ "sellConditions" ต้องอ้างอิงจากค่า แนวรับ (Support) / แนวต้าน (Resistance) / EMA / Bollinger Bands ที่ให้มาข้างต้นเท่านั้น
ห้ามตั้งตัวเลขราคาขึ้นมาเองที่ไม่มีในข้อมูล ถ้าไม่มีตัวเลขให้อ้างอิงได้จริง ให้อธิบายเป็นเงื่อนไขเชิงคุณภาพแทน (เช่น "รอราคาย่อกลับมาที่แนวรับ") โดยไม่ต้องระบุตัวเลข

สำคัญมาก: ต้องใส่ field "action" เป็น key แรกสุดของ JSON เสมอ (ก่อน field อื่นทั้งหมด) เพราะระบบอ่านค่านี้ก่อนเป็นอันดับแรก
ตามด้วย "thesisBroken", "sellAllEvidenceTypes" และ "sellAllEvidence" เป็น key ที่ 2-4 เสมอ (ระบบฝั่ง server ตรวจสอบ
ฟิลด์เหล่านี้แยกจาก action โดยอัตโนมัติเพื่อยืนยันว่า SELL_ALL มีเหตุผล thesis-breaking เฉพาะบริษัทจริง โดยยึด
sellAllEvidenceTypes (enum ที่อนุญาต) เป็นตัวตัดสินหลัก — ถ้าตรวจไม่ผ่านระบบจะลด action ลงเองโดยไม่แสดง SELL_ALL ให้
ผู้ใช้เห็น ดังนั้นต้องตอบฟิลด์เหล่านี้ให้ตรงความจริงเสมอ ห้ามใส่มั่ว)
ถ้าพื้นที่ตอบไม่พอสำหรับทุก field ให้ตัดท้าย (newsImpact/risks) ทิ้งได้ก่อน แต่ "action", "thesisBroken", "sellAllEvidenceTypes",
"sellAllEvidence", "technicalSummary" และ "summary" ต้องมีให้ครบเสมอ

ตอบเป็น JSON เท่านั้น ภาษาไทยสั้นกระชับ เรียง field ตามลำดับนี้ห้ามสลับ:
{
  "action": "BUY|HOLD|SELL_PARTIAL|SELL_ALL",
  "thesisBroken": false,
  "sellAllEvidenceTypes": [],
  "sellAllEvidence": [],
  "disclaimer": "บทวิเคราะห์โดย AI เพื่อประกอบการพิจารณาเท่านั้น ไม่ใช่คำแนะนำการลงทุน",
  "technicalSummary": "สรุปเทคนิคัล 2-3 ประโยค อ้างอิงค่า EMA/RSI/MACD/BB/Volume จริง",
  "summary": "สรุปมุมมองการลงทุนรวม 3-5 ประโยค ต้องครอบคลุม: มุมมองพื้นฐาน (fundamental), มุมมอง valuation (พร้อมระบุ confidence ถ้าข้อมูลไม่พอ), ผลกระทบต่อพอร์ต (position weight/concentration/เงินสด) และเหตุผลว่าทำไม action นี้เหมาะกับพอร์ตของผู้ใช้คนนี้โดยเฉพาะ ถ้ามุมมองเทคนิคัลกับพื้นฐาน/valuation ขัดแย้งกัน (เช่น เทคนิคัลอ่อนแอแต่พื้นฐาน/ราคาน่าสนใจ หรือกลับกัน) ต้องพูดถึงความขัดแย้งนี้ตรงๆ ห้ามสรุปด้านเดียว",
  "buyConditions": "ระบุเงื่อนไข/ราคาที่จะเข้าซื้อ อ้างอิงจาก Support/EMA/BB ที่ให้มาเท่านั้น รวมถึงข้อจำกัดเรื่องเงินสด/ขนาดโพซิชันถ้ามี (ใส่ 'N/A' หาก action เป็น SELL_PARTIAL หรือ SELL_ALL)",
  "sellConditions": "ระบุเงื่อนไข/ราคา/Stop Loss ที่ควรขายออก อ้างอิงจาก Resistance/EMA/BB ที่ให้มาเท่านั้น (ใส่ 'N/A' หาก action เป็น BUY)",
  "newsImpact": ["สรุปผลกระทบข่าวข้อ 1 (ระบุด้วยว่าเป็นข่าวเฉพาะบริษัทหรือข่าวภาพรวมตลาด)", "สรุปผลกระทบข่าวข้อ 2"],
  "risksAndOpportunities": {
    "caution": "ข้อควรระวังหรือจุดเสี่ยงเชิงเทคนิค/พื้นฐาน/พอร์ต (รวมเตือน earnings ถ้าใกล้ภายใน 7 วัน และเตือน concentration risk ถ้ามี)",
    "opportunity": "โอกาสหรือปัจจัยบวก"
  },
  "risks": ["ความเสี่ยงข้อ 1", "ความเสี่ยงข้อ 2"]
}`
// หมายเหตุ (นอก prompt): "thesisBroken" ต้องเป็น true และ "sellAllEvidenceTypes" ต้องมีอย่างน้อย 1 ค่าที่อยู่ใน
// allowlist enum (ดู ALLOWED_SELL_ALL_EVIDENCE_TYPES ด้านล่าง) หาก action เป็น SELL_ALL มิฉะนั้นระบบจะลด action
// ลงเองโดยอัตโนมัติ (ดู validation ด้านล่าง) — "sellAllEvidence" แบบ free-text ไม่ถูกใช้เป็นตัวอนุมัติหลักอีกต่อไป

  const validActions = ['BUY', 'HOLD', 'SELL_PARTIAL', 'SELL_ALL']

  // v1.12.0 (SELL_ALL Safeguard Hardening): allowlist enum เดียวที่ยอมให้เป็น "หลักฐาน thesis-breaking
  // เฉพาะบริษัท" จริงๆ — ตั้งใจไม่มี enum ใดๆ ที่สื่อถึงเทคนิคัล (EMA/MACD/RSI/downtrend), unrealized
  // loss/P&L, หรือข่าวภาพรวมตลาด/macro/ETF/sector เลย เพื่อปิดช่องที่ free-text เดิม (sellAllEvidence)
  // ยังให้ model ใส่เหตุผลเชิงเทคนิคผ่าน guard ได้ — ตอนนี้ enum เป็นตัวตัดสินหลักแทน free-text ทั้งหมด
  const ALLOWED_SELL_ALL_EVIDENCE_TYPES = [
    'FUNDAMENTAL_DETERIORATION',
    'FRAUD_GOVERNANCE',
    'SOLVENCY_LIQUIDITY',
    'STRUCTURAL_COMPETITIVE_LOSS',
    'SEVERE_REGULATORY_LEGAL',
    'BUSINESS_MODEL_IMPAIRMENT',
    'OTHER_PERMANENT_IMPAIRMENT',
  ]
  // v1.10.6 hotfix (edge review): เดิม fallback เป็น 'HOLD' เสมอเมื่อหา action ที่ valid ไม่เจอ — ทำให้
  // แยกไม่ออกระหว่าง "AI เลือก HOLD จริงๆ" กับ "หา action ไม่เจอเลย" (silent fallback) เปลี่ยนคืน null
  // แทนเมื่อไม่เจอ explicit valid action ใน raw text — เหตุผลเดิมของ regex fallback (ดึง action จาก raw
  // text ตรงๆ ก่อน parse JSON เผื่อ JSON ถูกตัดท้ายกลางคันตอน token หมดแต่ "action" เขียนไปแล้วตั้งแต่ต้น
  // เพราะเป็น key แรกสุดของ schema) ยังคงอยู่ครบ แค่เปลี่ยนค่า default ตอน "ไม่เจอจริงๆ" จาก 'HOLD' เป็น
  // null เพื่อให้ผู้เรียกตัดสินใจว่าควรถือเป็น error แทนได้
  function extractAction(raw: string): DetailedAnalysisResult['recommendation']['action'] | null {
    const m = raw.match(/"action"\s*:\s*"(BUY|HOLD|SELL_PARTIAL|SELL_ALL)"/)
    return (m && validActions.includes(m[1]) ? m[1] : null) as DetailedAnalysisResult['recommendation']['action'] | null
  }

  // sector/business ดึงจากข้อมูลนิ่ง (static mapping + Yahoo Finance fallback) ไม่ให้ AI สุ่มเขียนเองอีกต่อไป
  // กันปัญหาข้อความสลับไปมาไม่คงที่ทุกครั้งที่วิเคราะห์ใหม่ — ดึงคู่ขนานไปกับการเรียก Groq เพื่อไม่เสียเวลาเพิ่ม
  const stockMetaPromise = getStockMeta(symbol)

  const makeFallback = (message: string, error: DetailedAnalysisResult['error'], meta: { sector: string | null; business: string | null } = { sector: null, business: null }): DetailedAnalysisResult => ({
    symbol,
    disclaimer: 'บทวิเคราะห์นี้สร้างโดย AI เพื่อประกอบการตัดสินใจเท่านั้น ไม่ใช่คำแนะนำการลงทุน',
    technicalSummary: message,
    newsImpact: [],
    risksAndOpportunities: { caution: '', opportunity: '' },
    recommendation: { action: 'HOLD', buyConditions: '', sellConditions: '' },
    risks: [],
    summary: message,
    analysedAt: new Date().toISOString(),
    sector: meta.sector ?? '',
    business: meta.business ?? '',
    technical,
    usedPrice: current_price ?? null,
    usedNews: recentNews.map(n => ({ headline: n.headline, headlineTh: n.headlineTh, impact: n.impact ?? 'LOW' })),
    error,
    earnings,
  })

  const fallback = makeFallback('ไม่สามารถวิเคราะห์ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง', 'FAILED')

  try {
    // v1.12.0 (Portfolio-Aware Decision Framework): เพิ่ม token budget จาก 2000 -> 2600 เท่านั้น (ไม่แตะ
    // model/temperature/reasoning_effort/reasoning_format อื่นเลย) เพราะ "summary" ตอนนี้ต้องครอบคลุม
    // เนื้อหาเพิ่มมาก (fundamental/valuation/portfolio impact/ความขัดแย้งเทคนิคัล-fundamentals) จำเป็นต้อง
    // มีที่ให้เขียนพอ ไม่งั้นเสี่ยงโดนตัดทิ้งกลางคันบ่อยขึ้นทั้งที่ย้ายมาไว้ต้น schema แล้วก็ตาม
    const [{ text, rateLimited, rateLimitScope, usedModel }, stockMeta] = await Promise.all([
      callGroq(prompt, 2600),
      stockMetaPromise,
    ])

    // Groq โดน rate limit ทั้งโมเดลหลักและสำรองแล้ว — แสดง error ให้ชัดเจน แยกข้อความตามว่า
    // โดน per-minute (TPM/RPM รอแค่ ~1 นาที) หรือ per-day (TPD/RPD ต้องรอถึงวันถัดไป)
    // ไม่ใช่การ์ด HOLD ว่างเปล่าที่ดูเหมือนวิเคราะห์จริงแต่จริงๆ ไม่มีเนื้อหาอะไรเลย
    if (!text && rateLimited) {
      const message = rateLimitScope === 'minute'
        ? 'AI ใช้งานถี่เกินไปในนาทีนี้ (Groq rate limit ต่อนาที) รอสัก 1 นาทีแล้วลองใหม่ได้เลย'
        : 'เกินโควต้าการใช้งาน AI รายวันแล้ว (Groq API) กรุณาลองใหม่พรุ่งนี้เมื่อโควต้า reset'
      return makeFallback(message, 'RATE_LIMIT', stockMeta)
    }

    // v1.10.4 hotfix: Groq ตอบว่างเปล่าโดยไม่ได้โดน rate limit (เช่น HTTP error ที่ไม่ใช่ 429, network
    // error, หรือ Groq คืน content ว่างเฉยๆ) — เดิมโค้ดจะไหลต่อไป parse '{}' แล้วคืนผลลัพธ์ที่ดูเหมือน
    // สำเร็จ (action เป็น HOLD จาก fallbackAction, ทุก field ที่ AI ต้องสร้างเป็นค่าว่างหมด) โดยไม่มี
    // error flag เลย ทำให้ frontend เข้าใจผิดว่าวิเคราะห์สำเร็จ แสดงการ์งปกติ แต่ Technical Summary/RSI/
    // EMA/MACD/BB/Support/Resistance/Volume/News Impact/Risks หายทั้งก้อน (เพราะ AnalysisCard gate
    // การ์งพวกนี้ด้วย analysis.technicalSummary ตัวเดียว) ต้องถือว่านี่คือ error ไม่ใช่ผลวิเคราะห์จริง
    if (!text) {
      return makeFallback('AI ไม่ตอบกลับข้อมูล (Groq API error) กรุณาลองใหม่อีกครั้ง', 'FAILED', stockMeta)
    }

    // extractAction หา "action" ตรงๆ จาก raw text ก่อน — เพราะตอนนี้ "action" เป็น key แรกสุดของ JSON
    // (ย้ายมาไว้หน้าสุดเพราะเดิม nest อยู่ใน recommendation ท้ายๆ obj พอ Groq ตอบยาวจน token หมดกลางคัน
    // ฟิลด์ action เลยไม่ถูกเขียนออกมาเลย ทำให้ fallback เป็น HOLD ทุกครั้งที่ตัดกลางคัน)
    const fallbackAction = extractAction(text)
    const match = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match?.[0] ?? '{}')

    // v1.10.6 hotfix (edge review): action อาจเป็น null ได้แล้วถ้าทั้ง parsed.action และ fallbackAction
    // (regex บน raw text) ไม่เจอ explicit valid action เลย — ต้องเช็คก่อนใช้งาน ห้าม default เป็น HOLD
    // เองอีกต่อไป (ดูเหตุผลเต็มที่ extractAction ด้านบน)
    const action: DetailedAnalysisResult['recommendation']['action'] | null =
      validActions.includes(parsed.action) ? parsed.action : fallbackAction
    const technicalSummary = (parsed.technicalSummary ?? '').trim()
    const summary = (parsed.summary ?? '').trim()

    // v1.12.0 (Deterministic SELL_ALL Safeguard): ห้ามพึ่งแค่คำสั่งใน prompt ให้ AI "ไม่เลือก SELL_ALL
    // จากเทคนิคัล/P&L/ข่าวภาพรวมตลาดเพียงอย่างเดียว" เพราะ LLM ไม่ compliant 100% เสมอไป — ต้องมี
    // structured evidence (thesisBroken + sellAllEvidence) ที่ตรวจสอบได้จริงฝั่ง server แยกต่างหากจาก
    // action ก่อนจะยอมให้ SELL_ALL หลุดออกไปแสดงผลกับผู้ใช้ ถ้าตรวจไม่ผ่าน ต้อง downgrade action ลงเอง
    // แบบ deterministic (ไม่ใช่ auto-BUY เด็ดขาด) โดยไม่ hardcode ticker ใดๆ ทั้งสิ้น
    const thesisBroken = parsed.thesisBroken === true
    const sellAllEvidence: string[] = Array.isArray(parsed.sellAllEvidence)
      ? parsed.sellAllEvidence.filter((x: unknown) => typeof x === 'string' && x.trim().length > 0)
      : []
    // v1.12.0 (SELL_ALL Safeguard Hardening): เดิม gate ใช้ sellAllEvidence (free-text) ที่ model
    // สร้างเองเป็นตัวตัดสิน ทำให้เหตุผลเชิงเทคนิค (เช่น "price below EMA200/downtrend") ผ่าน structural
    // check ได้เพราะแค่เช็คว่า "มี string ไม่ว่าง" — ตอนนี้เปลี่ยนตัวตัดสินหลักเป็น sellAllEvidenceTypes
    // (enum) ที่ต้องอยู่ใน allowlist เท่านั้น ไม่มี enum สำหรับเทคนิคัล/P&L/macro เลย จึงปิดช่องนี้ได้จริง
    // sellAllEvidence (free-text) ยังคงเก็บไว้เป็นคำอธิบายประกอบเท่านั้น ไม่ใช้ตัดสินอนุมัติอีกต่อไป
    const sellAllEvidenceTypes: string[] = Array.isArray(parsed.sellAllEvidenceTypes)
      ? parsed.sellAllEvidenceTypes.filter((x: unknown) => typeof x === 'string' && ALLOWED_SELL_ALL_EVIDENCE_TYPES.includes(x))
      : []
    const hasValidSellAllEvidence = thesisBroken && sellAllEvidenceTypes.length > 0

    // v1.10.6 hotfix (edge review): ต้องมี explicit valid action (AI เขียนมาจริง ไม่ว่าจาก parsed JSON
    // ตรงๆ หรือ recover จาก raw text ตอน JSON ถูกตัดท้าย) ก่อนจะถือว่าเป็นผลวิเคราะห์ที่ใช้งานได้ — เดิม
    // ไม่เจอ action ก็ default เป็น 'HOLD' เงียบๆ ทำให้แยกไม่ออกว่า AI เลือก HOLD จริงหรือแค่หาไม่เจอ
    if (!action) {
      return makeFallback('AI ไม่ได้ระบุคำแนะนำที่ชัดเจน (action) กรุณาลองใหม่อีกครั้ง', 'FAILED', stockMeta)
    }

    let finalAction = action
    let downgradeNote = ''
    if (action === 'SELL_ALL' && !hasValidSellAllEvidence) {
      // downgrade เป้าหมาย: SELL_PARTIAL ถ้ากำไรเกิน +20% (ใช้ threshold เดียวกับเงื่อนไข SELL_PARTIAL
      // ในกรอบการตัดสินใจ เพื่อความสอดคล้องกัน) มิฉะนั้น HOLD — ห้าม upgrade เป็น BUY โดยเด็ดขาด
      finalAction = (pnl_pct != null && pnl_pct > 20) ? 'SELL_PARTIAL' : 'HOLD'
      downgradeNote = `ระบบปรับคำแนะนำจาก SELL_ALL เป็น ${finalAction} อัตโนมัติ เนื่องจาก AI ไม่ได้ให้หลักฐานเฉพาะบริษัทที่เข้าเงื่อนไข thesis-breaking (เกณฑ์ (ก)-(ช)) มากพอ จึงยังไม่ถือว่าพื้นฐานการลงทุนเสียหายจริง `
      // log เฉพาะ diagnostic ที่ไม่ sensitive (symbol + จำนวน/boolean เท่านั้น ไม่ log มูลค่าเงิน/สัดส่วนพอร์ต)
      console.warn(`[groq] SELL_ALL downgraded to ${finalAction} for ${symbol}: thesisBroken=${thesisBroken}, validEvidenceTypeCount=${sellAllEvidenceTypes.length}, evidenceTextCount=${sellAllEvidence.length}`)
    }


    // v1.10.4/v1.10.5 hotfix: แยก required structural field ออกจาก optional/legitimately-empty field
    // ชัดเจน — "technicalSummary" คือ field เดียวที่ frontend (PortfolioDashboard.tsx) ใช้เป็นเงื่อนไข
    // ครอบ Technical block ทั้งก้อน (รวม RSI/EMA/MACD/BB/Support/Resistance/Volume chips ที่มาจาก
    // "technical" object คนละตัวกัน) ถ้า technicalSummary ว่างแม้ field อื่นจะมีข้อมูลก็ตาม (เช่น summary
    // ไม่ว่างแต่ technicalSummary ว่างเดี่ยวๆ) UI จะซ่อน technical block ทั้งก้อนอยู่ดี จึงต้องถือว่าไม่ใช่
    // ผลวิเคราะห์ที่สมบูรณ์ ต้องคืน error แทน — เดิม guard เช็คแค่ "ทั้งคู่ว่าง" (AND) ทำให้เคส
    // technicalSummary='' + summary='X' หลุดผ่านเป็น "success" ปลอมได้ (จุดที่พบใน final edge review)
    //
    // ตั้งใจ "ไม่" บังคับ summary ให้ non-empty ด้วย (เหลือเป็น optional) เพราะ "summary" อยู่ท้ายสุดของ
    // JSON schema ในพรอมต์ — เป็น field ที่เสี่ยงโดนตัดทิ้งก่อนเพื่อนเวลา Groq token หมดกลางคัน (เหตุผล
    // เดียวกับที่ "action" ถูกย้ายมาไว้ต้น schema ตั้งแต่ v1.8) ถ้าบังคับ summary ด้วยจะทำให้คำตอบที่ตัด
    // ท้ายไปนิดเดียวแต่เนื้อหาจริงครบ (technical/news/risks) ถูกทิ้งเป็น error โดยไม่จำเป็น เช่นเดียวกับ
    // newsImpact/risks/risksAndOpportunities/buyConditions/sellConditions/earnings ที่ยังคงเป็น
    // optional เหมือนเดิม (ว่างได้จริงตามสถานการณ์ เช่น ไม่มีข่าว/ไม่มีความเสี่ยงเด่น/ไม่มีวันประกาศงบ)
    if (!technicalSummary) {
      return makeFallback('AI วิเคราะห์ไม่สมบูรณ์ (ไม่มีสรุปเทคนิคัล) กรุณาลองใหม่อีกครั้ง', 'FAILED', stockMeta)
    }

    const rawCaution = parsed.risksAndOpportunities?.caution ?? ''

    return {
      symbol,
      disclaimer: parsed.disclaimer ?? fallback.disclaimer,
      technicalSummary,
      newsImpact: Array.isArray(parsed.newsImpact) ? parsed.newsImpact : [],
      risksAndOpportunities: {
        caution: downgradeNote ? `${downgradeNote}${rawCaution}` : rawCaution,
        opportunity: parsed.risksAndOpportunities?.opportunity ?? '',
      },
      recommendation: {
        action: finalAction,
        buyConditions: parsed.buyConditions ?? '',
        sellConditions: parsed.sellConditions ?? '',
      },
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      summary,
      analysedAt: new Date().toISOString(),
      sector: stockMeta.sector ?? '',
      business: stockMeta.business ?? '',
      technical,
      usedPrice: current_price ?? null,
      usedNews: recentNews.map(n => ({ headline: n.headline, headlineTh: n.headlineTh, impact: n.impact ?? 'LOW' })),
      earnings,
      usedModel: usedModel ?? undefined,
      thesisBroken,
      sellAllEvidenceTypes,
      sellAllEvidence,
    }
  } catch (e) {
    console.error(`[groq] analyzeHoldingDetailed parse failed for ${symbol}:`, e)
    return fallback
  }
}

export async function translateAndClassifyNews(
  items: Array<{ symbol: string; headline: string; source: string; datetime: number; url: string }>
): Promise<Array<{ headlineTh: string; impact: 'NEGATIVE' | 'POSITIVE' | 'NEUTRAL' | 'LOW' }>> {
  if (!items.length) return []

  const list = items.map((it, i) => `${i + 1}. [${it.symbol}] ${it.headline}`).join('\n')
  const prompt = `แปลหัวข้อข่าวหุ้น US ต่อไปนี้เป็นภาษาไทย และประเมินผลกระทบต่อราคาหุ้น
NEGATIVE=ข่าวร้าย, POSITIVE=ข่าวดี, NEUTRAL=กลางๆ, LOW=เบา

ข่าว:
${list}

ตอบ JSON array เท่านั้น:
[{"headlineTh":"หัวข้อภาษาไทย","impact":"NEGATIVE|POSITIVE|NEUTRAL|LOW"},...]`

  try {
    const { text } = await callGroq(prompt, 1500)
    const match = text.match(/\[[\s\S]*\]/)
    const parsed = JSON.parse(match?.[0] ?? '[]')
    const valid = ['NEGATIVE', 'POSITIVE', 'NEUTRAL', 'LOW']
    return parsed.map((p: { headlineTh?: string; impact?: string }) => ({
      headlineTh: p.headlineTh ?? '',
      impact: (valid.includes(p.impact ?? '') ? p.impact : 'LOW') as 'NEGATIVE' | 'POSITIVE' | 'NEUTRAL' | 'LOW',
    }))
  } catch {
    return items.map(() => ({ headlineTh: '', impact: 'LOW' as const }))
  }
}
