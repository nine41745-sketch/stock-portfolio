/**
 * GET /api/health
 * ทดสอบการเชื่อมต่อบน production
 * ต้อง login ก่อนถึงจะเรียกได้ (middleware guard)
 */
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const results: Record<string, string> = {}

  // 1. Auth check
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    results.auth = user ? `✅ logged in as ${user.email}` : '❌ not authenticated'
  } catch (e: any) {
    results.auth = `❌ ${e.message}`
  }

  // 2. Supabase DB + pgcrypto
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const svc = createServiceClient()
      const { data, error } = await svc.rpc('get_decrypted_holdings', {
        p_user_id: user.id,
        p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
      })
      results.supabase_pgcrypto = error
        ? `❌ ${error.message}`
        : `✅ ${data?.length ?? 0} holdings (pgcrypto ok)`
    }
  } catch (e: any) {
    results.supabase_pgcrypto = `❌ ${e.message}`
  }

  // 3. Finnhub
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${process.env.FINNHUB_API_KEY}`
    )
    const data = await res.json()
    results.finnhub = data.c > 0
      ? `✅ AAPL = $${data.c}`
      : `❌ ${JSON.stringify(data)}`
  } catch (e: any) {
    results.finnhub = `❌ ${e.message}`
  }

  // 4. Groq AI
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 4,
      }),
    })
    const data = await res.json()
    results.groq = data.choices?.[0]?.message?.content
      ? `✅ ${data.choices[0].message.content.trim()}`
      : `❌ ${data.error?.message ?? JSON.stringify(data)}`
  } catch (e: any) {
    results.groq = `❌ ${e.message}`
  }

  const allOk = Object.values(results).every(v => v.startsWith('✅'))
  return NextResponse.json(
    { status: allOk ? 'ok' : 'degraded', checks: results },
    { status: allOk ? 200 : 500 }
  )
}
