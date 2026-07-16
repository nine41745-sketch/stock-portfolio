import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getMultipleQuotesWithMetrics } from '@/lib/finnhub'
import PortfolioDashboard from '@/components/portfolio/PortfolioDashboard'
import { HoldingWithPrice } from '@/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Decrypt holdings ผ่าน service_role
  const serviceClient = createServiceClient()
  const { data: rows, error } = await serviceClient.rpc('get_decrypted_holdings', {
    p_user_id: user.id,
    p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY!,
  })

  if (error) console.error('Holdings fetch error:', error)

  const holdings = rows ?? []
  const symbols: string[] = holdings.map((h: any) => h.symbol)

  // ราคา + metrics จาก Finnhub (sequential เพื่อไม่ rate limit)
  const priceData = symbols.length > 0 ? await getMultipleQuotesWithMetrics(symbols) : {}

  const holdingsWithPrices: HoldingWithPrice[] = holdings.map((h: any) => {
    const d = priceData[h.symbol]
    const cp = d?.price ?? null
    const mv = cp !== null && h.shares > 0 ? cp * h.shares : null
    const tc = h.cost_basis !== null && h.shares > 0 ? h.cost_basis * h.shares : null
    const pnl = mv !== null && tc !== null ? mv - tc : null
    const pnl_pct = pnl !== null && tc !== null && tc > 0 ? (pnl / tc) * 100 : null

    return {
      id: h.id,
      user_id: user.id,
      symbol: h.symbol,
      shares: Number(h.shares),
      cost_basis: h.cost_basis !== null ? Number(h.cost_basis) : null,
      notes: h.notes ?? null,
      created_at: h.created_at,
      updated_at: h.updated_at,
      current_price: cp,
      market_value: mv,
      total_cost: tc,
      pnl,
      pnl_pct,
      dayChange: d?.dayChange ?? null,
      pe: d?.pe ?? null,
      week52High: d?.week52High ?? null,
      week52Low: d?.week52Low ?? null,
    }
  })

  const userName = user.email?.split('@')[0] ?? 'User'

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <PortfolioDashboard
        holdings={holdingsWithPrices}
        userName={userName}
      />
    </div>
  )
}
