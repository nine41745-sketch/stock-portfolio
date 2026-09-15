import type { CSSProperties } from 'react'
import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'
import { getMultipleQuotesWithMetrics } from '@/lib/finnhub'
import PortfolioDashboard from '@/components/portfolio/PortfolioDashboard'
import AppTabs from '@/components/navigation/AppTabs'
import InvestingSinceBadge from '@/components/portfolio/InvestingSinceBadge'
import InactivityPinLock from '@/components/auth/InactivityPinLock'
import { HoldingWithPrice } from '@/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const portfolio = await resolveActivePortfolio(user.id, supabase)

  // Decrypt holdings ผ่าน service_role และ scope ตาม active portfolio หลัง migration v1.27.0
  const serviceClient = createServiceClient()
  const rpcArgs = portfolio.mode === 'portfolio'
    ? { p_user_id: user.id, p_portfolio_id: portfolio.portfolioId, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
    : { p_user_id: user.id, p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY! }
  const { data: rows, error } = await serviceClient.rpc('get_decrypted_holdings', rpcArgs)

  if (error) {
    console.error('Holdings fetch error:', error)
    throw new Error('PORTFOLIO_LOAD_FAILED')
  }

  const holdings = rows ?? []
  const symbols: string[] = holdings.map((h: any) => h.symbol)
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
  const activePortfolioName = portfolio.mode === 'portfolio' ? portfolio.portfolio.name : 'เจน'
  const portfolioTitleStyle = {
    '--active-portfolio-title': JSON.stringify(`📈 พอร์ต${activePortfolioName}`),
  } as CSSProperties

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <InactivityPinLock />
      <InvestingSinceBadge />
      <AppTabs />
      <div className="portfolio-dashboard-title-scope" style={portfolioTitleStyle}>
        <PortfolioDashboard holdings={holdingsWithPrices} userName={userName} />
      </div>
      <style>{`
        .portfolio-dashboard-title-scope h1:first-of-type {
          font-size: 0;
        }
        .portfolio-dashboard-title-scope h1:first-of-type::after {
          content: var(--active-portfolio-title);
          font-size: 1.5rem;
          line-height: 2rem;
        }
      `}</style>
    </div>
  )
}
