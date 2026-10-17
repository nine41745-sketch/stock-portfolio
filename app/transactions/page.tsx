import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'
import AppTabs from '@/components/navigation/AppTabs'
import TransactionLedger from '@/components/portfolio/TransactionLedger'
import TradingJournal from '@/components/portfolio/TradingJournal'
import DividendIntelligence from '@/components/portfolio/DividendIntelligence'
import AutoTradeEntry from '@/components/portfolio/AutoTradeEntry'
import InvestingSinceBadge from '@/components/portfolio/InvestingSinceBadge'
import InactivityPinLock from '@/components/auth/InactivityPinLock'

export const dynamic = 'force-dynamic'

export default async function TransactionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const portfolio = await resolveActivePortfolio(user.id, supabase)

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <InactivityPinLock />
      <InvestingSinceBadge />
      <AppTabs />
      <div className="mx-auto w-full max-w-7xl">
        <AutoTradeEntry />
        <div className="mt-6">
          <TransactionLedger />
          <div className="mt-6">
            <TradingJournal
              key={portfolio.portfolioId ?? 'legacy'}
              expectedPortfolioId={portfolio.mode === 'portfolio' ? portfolio.portfolioId : null}
              portfolioName={portfolio.mode === 'portfolio' ? portfolio.portfolio.name : 'หลัก'}
            />
          </div>
          <div className="mt-6"><DividendIntelligence /></div>
        </div>
      </div>
    </div>
  )
}
