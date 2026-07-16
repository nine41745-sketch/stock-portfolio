import Anthropic from '@anthropic-ai/sdk'
import { HoldingWithPrice, AnalysisResult } from '@/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function analyzeHolding(
  holding: HoldingWithPrice
): Promise<AnalysisResult> {
  const { symbol, shares, cost_basis, current_price, pnl_pct } = holding

  const prompt = `คุณเป็นนักวิเคราะห์หุ้น US มืออาชีพ วิเคราะห์หุ้นต่อไปนี้และให้สัญญาณซื้อ/ถือ/ขาย

หุ้น: ${symbol}
ราคาปัจจุบัน: $${current_price?.toFixed(2) ?? 'N/A'}
${cost_basis ? `ต้นทุนเฉลี่ย: $${cost_basis.toFixed(2)}` : 'ต้นทุน: ไม่ระบุ'}
${pnl_pct !== null ? `กำไร/ขาดทุน: ${pnl_pct > 0 ? '+' : ''}${pnl_pct.toFixed(1)}%` : ''}
จำนวนหุ้น: ${shares}

วิเคราะห์โดยพิจารณา:
1. แนวโน้มราคาปัจจุบันเทียบต้นทุน
2. ปัจจัยพื้นฐานของบริษัท (ที่รู้จากความรู้ทั่วไป)
3. ความเสี่ยงและโอกาส

ตอบใน JSON format นี้เท่านั้น:
{
  "signal": "BUY" | "HOLD" | "SELL",
  "summary": "สรุปสั้น 1 ประโยค",
  "reasons": ["เหตุผล 1", "เหตุผล 2", "เหตุผล 3"]
}`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}'

  try {
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch?.[0] ?? '{}')
    return {
      symbol,
      signal: parsed.signal ?? 'HOLD',
      summary: parsed.summary ?? '',
      reasons: parsed.reasons ?? [],
    }
  } catch {
    return { symbol, signal: 'HOLD', summary: 'ไม่สามารถวิเคราะห์ได้', reasons: [] }
  }
}
