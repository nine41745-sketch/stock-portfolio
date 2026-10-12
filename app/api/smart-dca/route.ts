import { getQuote } from '@/lib/finnhub'
import { PhaseAError, requirePhaseAPortfolio, phaseAErrorResponse } from '@/lib/phase-a-context'
import { calculateDcaPlan, parseDcaParameters, type DcaPosition, type DcaTarget } from '@/lib/smart-dca'

export const maxDuration = 60
const MAX_QUOTE_AGE_MS = 7 * 24 * 60 * 60 * 1000

async function loadSnapshot(expectedId?: string) {
  const { supabase, userId, portfolioId, portfolioName } = await requirePhaseAPortfolio(expectedId)
  const [holdings, settings, targets] = await Promise.all([
    supabase.from('holdings').select('symbol,shares').eq('user_id', userId).eq('portfolio_id', portfolioId).limit(101),
    supabase.from('user_settings').select('dime_balance').eq('user_id', userId).eq('portfolio_id', portfolioId).maybeSingle(),
    supabase.from('portfolio_allocation_targets').select('asset_key,target_pct').eq('user_id', userId).eq('portfolio_id', portfolioId).limit(51),
  ])
  if (holdings.error || settings.error || targets.error) throw new PhaseAError('อ่าน Holdings/DIME/Target Allocation ไม่สำเร็จ', 503)
  if ((holdings.data?.length ?? 0) > 100 || (targets.data?.length ?? 0) > 50) throw new PhaseAError('พอร์ตเกินขอบเขต Smart DCA Phase A', 409)
  const normalizedTargets: DcaTarget[] = (targets.data ?? []).map(t => ({ asset_key: String(t.asset_key), target_pct: t.target_pct === null ? NaN : Number(t.target_pct) }))
  const shares = new Map<string, number>((holdings.data ?? []).map(p => [String(p.symbol), p.shares === null ? NaN : Number(p.shares)]))
  const symbols = [...new Set([...shares.keys(), ...normalizedTargets.filter(t => t.asset_key !== 'DIME' && t.target_pct > 0).map(t => t.asset_key)])].sort()
  if (symbols.length > 100 || symbols.some(s => !/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(s))) throw new PhaseAError('ข้อมูล symbol ไม่ถูกต้องหรือเกินขอบเขต', 409)
  const positions: DcaPosition[] = []
  const now = Date.now()
  // Use the existing provider with bounded concurrency. A failed/stale quote stays null.
  for (let i = 0; i < symbols.length; i += 4) {
    const quotes = await Promise.all(symbols.slice(i, i + 4).map(async symbol => {
      const quote = await getQuote(symbol)
      const timestamp = typeof quote?.t === 'number' ? quote.t * 1000 : NaN
      const price = quote && Number.isFinite(quote.c) && quote.c > 0 && Number.isFinite(timestamp) && now - timestamp <= MAX_QUOTE_AGE_MS && timestamp <= now + 300_000 ? quote.c : null
      return { symbol, shares: shares.get(symbol) ?? 0, price }
    }))
    positions.push(...quotes)
  }
  const dime = settings.data?.dime_balance
  return { portfolio: { id: portfolioId, name: portfolioName }, positions, targets: normalizedTargets, dime_balance: dime === undefined || dime === null ? null : Number(dime), as_of: new Date(now).toISOString(), quote_policy: 'ใช้ราคาล่าสุดจาก Finnhub cache; timestamp ต้องไม่เกิน 7 วัน และไม่อ้างว่าเป็นราคา execution' }
}

export async function GET() {
  try { return Response.json(await loadSnapshot(), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return phaseAErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin')
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new PhaseAError('Cross-origin request rejected', 403)
    if (Number(request.headers.get('content-length') ?? 0) > 4096) throw new PhaseAError('ข้อมูลแผนใหญ่เกินขอบเขต', 413)
    let body: Record<string, unknown>
    try {
      const text = await request.text()
      if (text.length > 4096) throw new PhaseAError('ข้อมูลแผนใหญ่เกินขอบเขต', 413)
      const raw = JSON.parse(text)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.portfolio_id !== 'string') throw new Error('invalid')
      body = raw
    } catch (error) {
      if (error instanceof PhaseAError) throw error
      throw new PhaseAError('ข้อมูลแผนไม่ถูกต้อง', 400)
    }
    let params
    try { params = parseDcaParameters(body) } catch (error) { throw new PhaseAError(error instanceof Error ? error.message : 'ข้อมูลแผนไม่ถูกต้อง', 400) }
    const snapshot = await loadSnapshot(body.portfolio_id as string)
    return Response.json({ ...snapshot, plan: calculateDcaPlan(snapshot.positions, snapshot.targets, snapshot.dime_balance, params) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return phaseAErrorResponse(error) }
}
