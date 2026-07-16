import { HoldingWithPrice, AnalysisResult } from '@/types'

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

ตอบใน JSON format นี้เท่านั้น:
{
  "signal": "BUY" หรือ "HOLD" หรือ "SELL",
  "summary": "สรุปสั้น 1 ประโยคภาษาไทย",
  "reasons": ["เหตุผล 1 ภาษาไทย", "เหตุผล 2", "เหตุผล 3"]
}`

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.7 },
      }),
    }
  )

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'

  try {
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
