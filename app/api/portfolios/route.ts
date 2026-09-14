import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  ACTIVE_PORTFOLIO_COOKIE,
  isPortfolioFoundationMissing,
  resolveActivePortfolio,
} from '@/lib/portfolio-context'

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
}

function migrationRequired() {
  return NextResponse.json({
    error: 'Multi-Portfolio ยังไม่ได้ติดตั้งฐานข้อมูล',
    migration_required: true,
    migration: 'supabase/migration_multi_portfolio_v1.27.0.sql',
  }, { status: 503 })
}

function parseName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('กรุณาใส่ชื่อพอร์ต')
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('กรุณาใส่ชื่อพอร์ต')
  if (name.length > 40) throw new Error('ชื่อพอร์ตต้องไม่เกิน 40 ตัวอักษร')
  if(/[\u0000-\u001F\u007F]/.test(name)) throw new Error('ชื่อพอร์ตมีอักขระที่ไม่รองรับ')
  return name
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const context = await resolveActivePortfolio(user.id, supabase)
  if (context.mode === 'legacy') return migrationRequired()

  const response = NextResponse.json({
    active_portfolio_id: context.portfolioId,
    portfolios: context.portfolios,
  }, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.set(ACTIVE_PORTFOLIO_COOKIE, context.portfolioId, COOKIE_OPTIONS)
  return response
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let name: string
  try {
    const body = await request.json() as { name?: unknown }
    name = parseName(body?.name)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  const context = await resolveActivePortfolio(user.id, supabase)
  if (context.mode === 'legacy') return migrationRequired()

  const { data, error } = await supabase
    .from('portfolios')
    .insert({ user_id: user.id, name, is_default: false })
    .select('id, name, is_default, created_at')
    .single()

  if (error) {
    if (isPortfolioFoundationMissing(error)) return migrationRequired()
    if (String(error.code ?? '') === '23505') {
      return NextResponse.json({ error: `มีพอร์ตชื่อ “${name}” อยู่แล้ว` }, { status: 409 })
    }
    console.error('[portfolios:POST] create failed:', error)
    return NextResponse.json({ error: 'สร้างพอร์ตไม่สำเร็จ' }, { status: 500 })
  }

  const response = NextResponse.json({ portfolio: data })
  response.cookies.set(ACTIVE_PORTFOLIO_COOKIE, String(data.id), COOKIE_OPTIONS)
  return response
}
