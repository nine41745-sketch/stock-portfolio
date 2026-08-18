/**
 * GET /api/health
 * ทดสอบการเชื่อมต่อบน production — ต้อง login ก่อนเสมอ
 * (route นี้ไม่ผ่าน middleware เพราะ /api/* ถูกยกเว้นใน matcher จึงต้อง guard เองตรงนี้)
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // guard: ต้อง login ก่อนถึงจะเรียก health check ได้
  // ป้องกันไม่ให้คนนอกใช้ route นี้เป็น proxy ยิง Finnhub/Groq ฟรีๆ หรือเห็น error message ภายใน
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const results: Record<string, string> = {}
  results.auth = `✅ logged in as ${user.email}`

  // 1. Supabase DB — เช็คแค่ connectivity ด้วย RLS-scoped client (ไม่ decrypt ข้อมูลจริง)
  try {
    const { error } = await supabase
      .from('holdings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    results.supabase_db = error ? `❌ ${error.message}` : '✅ connected'
  } catch (e: any) {
    results.supabase_db = `❌ ${e.message}`
  }

  // 2. Finnhub
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${process.env.FINNHUB_API_KEY}`,
      { cache: 'no-store' }
    )
    const data = await res.json()
    results.finnhub = data.c > 0 ? '✅ ok' : `❌ ${JSON.stringify(data)}`
  } catch (e: any) {
    results.finnhub = `❌ ${e.message}`
  }

  // 3. Groq AI
  // v1.10.8 hotfix (GPT-OSS compatibility + diagnostic): เปลี่ยน max_tokens -> max_completion_tokens
  // (parameter name ที่ openai/gpt-oss-* ต้องการ) + reasoning_effort/reasoning_format เหมือนกับ
  // lib/groq.ts ทุกประการ เพื่อให้ health check สะท้อนพฤติกรรมจริงของ runtime call — เดิมถ้า Groq ตอบ
  // กลับมาแบบไม่มี content (ไม่ว่าเพราะ HTTP error หรือ 200 ที่ content ว่าง) จะโชว์แค่ "unknown" เฉยๆ
  // วินิจฉัยสาเหตุจริงไม่ได้เลย เพิ่ม diagnostic ให้เห็น HTTP status/error body/finish_reason ตรงๆ
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'Say OK' }],
        max_completion_tokens: 64,
        reasoning_effort: 'low',
        reasoning_format: 'hidden',
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      results.groq = `❌ HTTP ${res.status}: ${errText.slice(0, 300)}`
    } else {
      const data = await res.json()
      const content = data.choices?.[0]?.message?.content
      if (content) {
        results.groq = '✅ ok'
      } else {
        const finishReason = data.choices?.[0]?.finish_reason ?? 'ไม่ทราบ'
        results.groq = `❌ HTTP 200 แต่ content ว่าง (finish_reason: ${finishReason}) response: ${JSON.stringify(data).slice(0, 300)}`
      }
    }
  } catch (e: any) {
    results.groq = `❌ ${e.message}`
  }

  const allOk = Object.values(results).every(v => v.startsWith('✅'))
  return NextResponse.json(
    { status: allOk ? 'ok' : 'degraded', checks: results },
    { status: allOk ? 200 : 500 }
  )
}
