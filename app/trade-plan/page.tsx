import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppTabs from '@/components/navigation/AppTabs'
import TradePlanWorkspace, { type TradePlanPrefill } from '@/components/portfolio/TradePlanWorkspace'
import InvestingSinceBadge from '@/components/portfolio/InvestingSinceBadge'
import InactivityPinLock from '@/components/auth/InactivityPinLock'

export const dynamic = 'force-dynamic'

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function TradePlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const source = pick(params.source) === 'STOCK_CHECK' ? 'STOCK_CHECK' : undefined
  const initialDraft: TradePlanPrefill = {
    symbol: pick(params.symbol),
    entryLow: pick(params.entryLow),
    entryHigh: pick(params.entryHigh),
    stopLoss: pick(params.stop),
    target1: pick(params.target1),
    target2: pick(params.target2),
    budget: pick(params.budget),
    source,
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <InactivityPinLock />
      <InvestingSinceBadge />
      <AppTabs />
      <TradePlanWorkspace initialDraft={initialDraft} />
    </div>
  )
}
