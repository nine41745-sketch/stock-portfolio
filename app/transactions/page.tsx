import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppTabs from '@/components/navigation/AppTabs'
import TransactionLedger from '@/components/portfolio/TransactionLedger'
import InvestingSinceBadge from '@/components/portfolio/InvestingSinceBadge'
import InactivityPinLock from '@/components/auth/InactivityPinLock'

export const dynamic = 'force-dynamic'

export default async function TransactionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <InactivityPinLock />
      <InvestingSinceBadge />
      <AppTabs />
      <TransactionLedger />
    </div>
  )
}
