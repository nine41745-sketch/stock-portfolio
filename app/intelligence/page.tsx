import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppTabs from '@/components/navigation/AppTabs'
import InvestingSinceBadge from '@/components/portfolio/InvestingSinceBadge'
import InactivityPinLock from '@/components/auth/InactivityPinLock'
import MarketIntelligenceWorkspace from '@/components/portfolio/MarketIntelligenceWorkspace'

export const dynamic = 'force-dynamic'

export default async function IntelligencePage() {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) redirect('/login')
  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <InactivityPinLock />
      <InvestingSinceBadge />
      <AppTabs />
      <MarketIntelligenceWorkspace />
    </div>
  )
}