import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'
import AppTabs from '@/components/navigation/AppTabs'
import InactivityPinLock from '@/components/auth/InactivityPinLock'
import InvestingSinceBadge from '@/components/portfolio/InvestingSinceBadge'
import DiscoveryWorkspace from '@/components/portfolio/DiscoveryWorkspace'
import PortfolioRequiredNotice from '@/components/portfolio/PortfolioRequiredNotice'

export const dynamic = 'force-dynamic'

export default async function DiscoveryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const portfolio = await resolveActivePortfolio(user.id, supabase)
  if (portfolio.mode === 'empty') return <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-950 md:p-8">
    <InactivityPinLock /><InvestingSinceBadge /><AppTabs /><PortfolioRequiredNotice />
  </div>
  return <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-950 md:p-8">
    <InactivityPinLock />
    <InvestingSinceBadge />
    <AppTabs />
    <DiscoveryWorkspace key={portfolio.portfolioId ?? 'legacy'} activePortfolioId={portfolio.portfolioId} />
  </div>
}
