import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
