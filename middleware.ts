import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { PIN_SESSION_COOKIE_NAME, verifyPinSessionValue, getSupabaseSessionId } from '@/lib/pin-session'

// ============================================================
// PIN Lock (ชั้นป้องกันที่ 2 หลัง Gmail/Supabase Auth):
// API route และหน้าที่มีข้อมูลส่วนตัวของพอร์ต ต้องผ่านทั้ง Supabase Auth (login แล้ว) และ PIN-unlocked
// session (ผ่าน PIN 6 หลักแล้ว) — สอง session แยกกันเด็ดขาด กด "🔒 ล็อก" ลบแค่ PIN session ไม่แตะ
// Supabase Auth เลย (ห้าม signOut) ส่วนกด "ออกจากระบบ" ลบทั้งคู่
//
// รายการ path ที่ "ยกเว้น" ไม่ต้องผ่าน PIN-gate (ต้องเรียกได้ก่อน unlock เสมอ เพราะเป็น route ที่ใช้
// ทำการ unlock เอง หรือเป็น trusted server process ที่ไม่ใช่ interactive user session):
//   /api/pin/status  — เช็คว่ามี PIN หรือยัง/กำลังล็อกอยู่ไหม (ใช้ตัดสินใจว่าจะโชว์หน้าไหน)
//   /api/pin/setup   — ตั้ง PIN ครั้งแรก (chicken-and-egg: ยังไม่มี PIN จะ unlock ไม่ได้)
//   /api/pin/verify  — route ที่ทำการ unlock เอง
//   /api/pin/lock    — กดล็อกได้ทุกสถานะ ไม่คืนข้อมูลส่วนตัวใดๆ
//   /api/cron/*      — auth ด้วย CRON_SECRET แยกต่างหาก เป็น trusted server process (Vercel Cron) ไม่ใช่
//                      interactive user session ไม่มี PIN session ให้ตรวจอยู่แล้ว (ตามที่กำชับไว้)
//   /api/health      — health check เฉยๆ ไม่มีข้อมูลส่วนตัว
// หมายเหตุ: /api/pin/change "ไม่" ยกเว้น — ต้อง unlock อยู่แล้วถึงจะเปลี่ยน PIN ได้ (เป็น sensitive
// action อยู่ใน Settings หลัง unlock ตามที่ออกแบบไว้)
// ============================================================
const PIN_EXEMPT_API_PREFIXES = ['/api/pin/status', '/api/pin/setup', '/api/pin/verify', '/api/pin/lock', '/api/cron/', '/api/health']
const PIN_EXEMPT_PAGES = ['/login', '/pin']

function isPinExemptApi(pathname: string): boolean {
  return PIN_EXEMPT_API_PREFIXES.some(p => pathname.startsWith(p))
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // v1.8.0: เพิ่ม middleware เป็นชั้นป้องกันเสริม (defense-in-depth) สำหรับ /api/*
  // ทุก API route ปัจจุบันเช็ค auth.getUser() เองอยู่แล้วทุกจุด (ไม่กระทบพฤติกรรมเดิม)
  // แต่เผื่ออนาคตมี route ใหม่ที่ลืมใส่ auth guard จะยังโดนกันไว้ที่ชั้นนี้ก่อน
  // ยกเว้น /api/cron/* ที่ auth ด้วย CRON_SECRET แยกต่างหาก ไม่ได้ใช้ user session
  if (!user && pathname.startsWith('/api/') && !pathname.startsWith('/api/cron/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!user && pathname !== '/login' && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // ============================================================
  // PIN-gate: ทำงานเฉพาะตอน Supabase Auth ผ่านแล้ว (user ไม่ null) เท่านั้น — ต่อจากจุดนี้การ block ทั้งหมด
  // คือ "login Gmail แล้วแต่ยังไม่ผ่าน PIN" ไม่ใช่ "ยังไม่ login" (ซึ่งถูกจัดการไปแล้วด้านบน) เช็ค
  // pinUnlocked ครั้งเดียวใช้ร่วมกันทุกเงื่อนไขด้านล่าง ไม่ต้อง verify cookie ซ้ำหลายรอบต่อ request
  // ============================================================
  if (user) {
    // v1.10.10 hotfix (session binding): getSession() อ่านจาก cookie ตรงๆ ไม่ยิง network request ซ้ำ
    // (ต่างจาก getUser() ด้านบนที่ยืนยันกับ Supabase Auth server จริง) แค่ใช้ดึง access_token ปัจจุบันมา
    // decode เอา session_id claim สำหรับผูก PIN session เข้ากับรอบ login นี้เท่านั้น
    const { data: { session } } = await supabase.auth.getSession()
    const supaSessionId = getSupabaseSessionId(session?.access_token)
    const pinCookie = request.cookies.get(PIN_SESSION_COOKIE_NAME)?.value
    const pinUnlocked = await verifyPinSessionValue(pinCookie, user.id, supaSessionId)

    if (pathname === '/login') {
      // unlock แล้วเข้า dashboard ตามเดิม, ยังไม่ unlock ให้ไปหน้า PIN ต่อเลย (กันอ้อมผ่าน /dashboard
      // แล้วโดน redirect ซ้ำอีกที ไม่ใช่พฤติกรรมผิด แค่ตัดขั้นตอนที่ไม่จำเป็นออก)
      return NextResponse.redirect(new URL(pinUnlocked ? '/dashboard' : '/pin', request.url))
    }

    // API ส่วนตัว (holdings/analyze/daily-analyses/track-record/scratchpad/user-settings/news/prices/
    // exchange-rate ฯลฯ) — block ด้วย 401 JSON เหมือน pattern เดิมของ middleware นี้ทุกประการ ไม่ให้
    // DevTools เรียก API ตรงๆ อ่าน/แก้ข้อมูล portfolio ได้แม้ UI จะโชว์หน้าล็อกอยู่ก็ตาม
    if (!pinUnlocked && pathname.startsWith('/api/') && !isPinExemptApi(pathname)) {
      return NextResponse.json({ error: 'PIN required' }, { status: 401 })
    }

    // หน้าเว็บส่วนตัว (เช่น /dashboard) — redirect ไปหน้า /pin ก่อนที่ Server Component จะเริ่มดึงข้อมูล
    // holdings ใดๆ เลย (เช่น app/dashboard/page.tsx ที่ fetch เองตรงๆ ไม่ผ่าน API) กันข้อมูลหลุดเข้า HTML
    // payload ตั้งแต่ต้นแม้จะยังไม่เห็น UI ก็ตาม
    if (!pinUnlocked && !pathname.startsWith('/api/') && !PIN_EXEMPT_PAGES.includes(pathname)) {
      return NextResponse.redirect(new URL('/pin', request.url))
    }

    // unlock แล้วแต่ยังไปหน้า /pin อยู่ (เช่น กด back) — เด้งกลับ dashboard ไม่ต้องให้กรอก PIN ซ้ำ
    if (pinUnlocked && pathname === '/pin') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
