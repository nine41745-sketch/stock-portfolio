import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActivePortfolio } from '@/lib/portfolio-context'
import AppTabs from '@/components/navigation/AppTabs'
import DailyActionsWorkspace from '@/components/portfolio/DailyActionsWorkspace'
import InvestingSinceBadge from '@/components/portfolio/InvestingSinceBadge'
import InactivityPinLock from '@/components/auth/InactivityPinLock'
import PortfolioRequiredNotice from '@/components/portfolio/PortfolioRequiredNotice'

export const dynamic = 'force-dynamic'

// v1.41.51: สรุปคำแนะนำวันนี้ของหุ้นที่ถืออยู่ — อ่านผลวิเคราะห์ที่บันทึกไว้ผ่าน /api/daily-analyses/today (ไม่เรียก AI ตอนเปิดหน้า)
export default async function DailyActionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const portfolio = await resolveActivePortfolio(user.id, supabase)

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <InactivityPinLock />
      <InvestingSinceBadge />
      <AppTabs />
      {portfolio.mode === 'empty' ? (
        <PortfolioRequiredNotice />
      ) : (
        <div className="mx-auto w-full max-w-5xl">
          <DailyActionsWorkspace />
        </div>
      )}
    </div>
  )
}
