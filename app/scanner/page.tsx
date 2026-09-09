import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppTabs from '@/components/navigation/AppTabs'
import ScannerWorkspace from '@/components/portfolio/ScannerWorkspace'
import InvestingSinceBadge from '@/components/portfolio/InvestingSinceBadge'
import InactivityPinLock from '@/components/auth/InactivityPinLock'

export const dynamic = 'force-dynamic'

export default async function ScannerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: holdings, error } = await supabase
    .from('holdings')
    .select('symbol, shares')
    .eq('user_id', user.id)
    .gt('shares', 0)

  if (error) {
    console.error('[scanner-page] holdings lookup failed:', error)
    throw new Error('SCANNER_HOLDINGS_LOAD_FAILED')
  }

  const holdingSymbols = (holdings ?? []).map(row => String(row.symbol).toUpperCase())

  // ScannerWorkspace keeps the existing OpportunityHub (Scanner/Watchlist) intact and adds Stock Check.
  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <InactivityPinLock />
      <InvestingSinceBadge />
      <AppTabs />
      <ScannerWorkspace holdingSymbols={holdingSymbols} />
    </div>
  )
}
