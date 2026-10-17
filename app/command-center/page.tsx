import { redirect } from 'next/navigation'
import AppTabs from '@/components/navigation/AppTabs'
import InactivityPinLock from '@/components/auth/InactivityPinLock'
import InvestingSinceBadge from '@/components/portfolio/InvestingSinceBadge'
import InvestmentCommandCenter from '@/components/portfolio/InvestmentCommandCenter'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function InvestmentCommandCenterPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <InactivityPinLock />
      <InvestingSinceBadge />
      <AppTabs />
      <InvestmentCommandCenter />
    </div>
  )
}
