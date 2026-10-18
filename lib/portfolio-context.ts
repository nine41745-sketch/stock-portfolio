import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export const ACTIVE_PORTFOLIO_COOKIE = 'stock-active-portfolio'

export interface PortfolioSummary {
  id: string
  name: string
  is_default: boolean
  created_at: string
}

export type ActivePortfolioContext =
  | { mode: 'legacy'; portfolioId: null; portfolio: null; portfolios: [] }
  | { mode: 'empty'; portfolioId: null; portfolio: null; portfolios: [] }
  | { mode: 'portfolio'; portfolioId: string; portfolio: PortfolioSummary; portfolios: PortfolioSummary[] }

export function noPortfolioResponse(): Response {
  return Response.json({
    error: 'ยังไม่มี Portfolio สำหรับบัญชีนี้ กรุณาสร้างพอร์ตก่อน',
    code: 'PORTFOLIO_REQUIRED',
    portfolio_required: true,
  }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

export function isPortfolioFoundationMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  const message = String(error.message ?? '').toLowerCase()
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)
    || message.includes('portfolios') && (message.includes('does not exist') || message.includes('schema cache'))
    || message.includes('portfolio_id') && (message.includes('does not exist') || message.includes('schema cache'))
}

export async function resolveActivePortfolio(
  userId: string,
  supabaseArg?: Awaited<ReturnType<typeof createClient>>,
): Promise<ActivePortfolioContext> {
  const supabase = supabaseArg ?? await createClient()
  const { data, error } = await supabase
    .from('portfolios')
    .select('id, name, is_default, created_at')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) {
    if (isPortfolioFoundationMissing(error)) {
      return { mode: 'legacy', portfolioId: null, portfolio: null, portfolios: [] }
    }
    console.error('[portfolio-context] portfolios lookup failed:', error)
    throw new Error('PORTFOLIO_CONTEXT_LOAD_FAILED')
  }

  const portfolios = (data ?? []).map(row => ({
    id: String(row.id),
    name: String(row.name),
    is_default: Boolean(row.is_default),
    created_at: String(row.created_at),
  }))

  if (portfolios.length === 0) {
    return { mode: 'empty', portfolioId: null, portfolio: null, portfolios: [] }
  }

  const cookieStore = await cookies()
  const requestedId = cookieStore.get(ACTIVE_PORTFOLIO_COOKIE)?.value
  const requested = isUuid(requestedId) ? portfolios.find(portfolio => portfolio.id === requestedId) : undefined
  const active = requested ?? portfolios.find(portfolio => portfolio.is_default) ?? portfolios[0]

  return {
    mode: 'portfolio',
    portfolioId: active.id,
    portfolio: active,
    portfolios,
  }
}
