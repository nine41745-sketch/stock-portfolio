import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ACTIVE_PORTFOLIO_COOKIE, isPortfolioFoundationMissing } from '@/lib/portfolio-context'

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let portfolioId: string
  try {
    const body = await request.json() as { portfolio_id?: unknown }
    if (!isUuid(body?.portfolio_id)) throw new Error('Portfolio id ไม่ถูกต้อง')
    portfolioId = body.portfolio_id
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('portfolios')
    .select('id')
    .eq('id', portfolioId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    if (isPortfolioFoundationMissing(error)) {
      return NextResponse.json({ error: 'Multi-Portfolio ยังไม่ได้ติดตั้งฐานข้อมูล', migration_required: true }, { status: 503 })
    }
    console.error('[portfolios:select] lookup failed:', error)
    return NextResponse.json({ error: 'ตรวจสอบพอร์ตไม่สำเร็จ' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'ไม่พบพอร์ตนี้' }, { status: 404 })

  const response = NextResponse.json({ ok: true, active_portfolio_id: portfolioId })
  response.cookies.set(ACTIVE_PORTFOLIO_COOKIE, portfolioId, COOKIE_OPTIONS)
  return response
}
