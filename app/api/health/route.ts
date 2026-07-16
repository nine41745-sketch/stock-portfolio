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

  // 4. Anthropic
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Say OK' }],
      }),
    })
    const data = await res.json()
    results.claude = data.content?.[0]?.text
      ? `✅ ${data.content[0].text.trim()}`
      : `❌ ${data.error?.message ?? JSON.stringify(data)}`
  } catch (e: any) {
    results.claude = `❌ ${e.message}`
  }

  const allOk = Object.values(results).every(v => v.startsWith('✅'))
  return NextResponse.json(
    { status: allOk ? 'ok' : 'degraded', checks: results },
    { status: allOk ? 200 : 500 }
  )
}
