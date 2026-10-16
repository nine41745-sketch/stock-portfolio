import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ACTIVE_PORTFOLIO_COOKIE } from '@/lib/portfolio-context'
import { PIN_SESSION_COOKIE_NAME, getSupabaseSessionId, verifyPinSessionValue } from '@/lib/pin-session'

export class PhaseAError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

// Read-only context: unlike resolveActivePortfolio, never creates a default portfolio.
export async function requirePhaseAPortfolio(expectedId?: string, requestClient?: Awaited<ReturnType<typeof createClient>>) {
  const supabase = requestClient ?? await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AuthRetryableFetchError') {
    throw new PhaseAError('บริการยืนยันตัวตนไม่พร้อม', 503)
  }
  if (error || !user) throw new PhaseAError('Unauthorized', 401)
  const cookieStore = await cookies()
  const { data: { session } } = await supabase.auth.getSession()
  const unlocked = await verifyPinSessionValue(cookieStore.get(PIN_SESSION_COOKIE_NAME)?.value, user.id, getSupabaseSessionId(session?.access_token))
  if (!unlocked) throw new PhaseAError('PIN required', 401)
  const result = await supabase.from('portfolios').select('id, name, is_default, created_at').eq('user_id', user.id).order('created_at', { ascending: true })
  if (result.error) throw new PhaseAError('อ่าน Portfolio ไม่สำเร็จ; ต้องมี Multi-Portfolio schema', 503)
  const portfolios = result.data ?? []
  if (!portfolios.length) throw new PhaseAError('ยังไม่มี Portfolio สำหรับวางแผน', 409)
  const requested = cookieStore.get(ACTIVE_PORTFOLIO_COOKIE)?.value
  const portfolio = requested ? portfolios.find(p => p.id === requested) : portfolios.find(p => p.is_default) ?? portfolios[0]
  if (!portfolio || (expectedId !== undefined && portfolio.id !== expectedId)) throw new PhaseAError('Portfolio เปลี่ยนแล้ว กรุณาโหลดหน้าใหม่', 409)
  return { supabase, userId: user.id, portfolioId: String(portfolio.id), portfolioName: String(portfolio.name) }
}

export function phaseAErrorResponse(error: unknown): Response {
  const status = error instanceof PhaseAError ? error.status : 500
  // Never log ledger rows, keys or upstream bodies.
  return Response.json({ error: error instanceof PhaseAError ? error.message : 'โหลดข้อมูลไม่สำเร็จ' }, { status, headers: { 'Cache-Control': 'no-store' } })
}
