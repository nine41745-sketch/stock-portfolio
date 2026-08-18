import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PinGate from '@/components/auth/PinGate'

export const dynamic = 'force-dynamic'

// หน้า PIN Lock — แสดงหลัง Gmail/Supabase login สำเร็จแต่ยังไม่ผ่าน PIN (หรือยังไม่เคยตั้ง PIN)
// ไม่ fetch holdings/ข้อมูลส่วนตัวใดๆ ในหน้านี้เลย (ต่างจาก app/dashboard/page.tsx) — ปลอดภัยให้ render
// ได้แม้ PIN ยังไม่ unlock เพราะไม่มีข้อมูลอะไรให้หลุด
export default async function PinPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">📈 พอร์ตน้องเจน</h1>
          <p className="mt-2 text-gray-400">ยืนยันตัวตนด้วย PIN เพื่อเข้าพอร์ต</p>
        </div>
        <PinGate userEmail={user.email ?? ''} />
      </div>
    </div>
  )
}
