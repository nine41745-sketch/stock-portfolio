import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { PIN_SESSION_COOKIE_NAME, verifyPinSessionValue, getSupabaseSessionId } from '@/lib/pin-session'

// Network boundary for Auth + PIN defense-in-depth. Next.js 16 renamed middleware.ts to proxy.ts;
// behavior is intentionally preserved while moving this guard onto the supported Node.js proxy runtime.
const PIN_EXEMPT_API_PREFIXES = ['/api/pin/status', '/api/pin/setup', '/api/pin/verify', '/api/pin/lock', '/api/cron/', '/api/health']
const PIN_EXEMPT_PAGES = ['/login', '/pin']

function isPinExemptApi(pathname: string): boolean {
  return PIN_EXEMPT_API_PREFIXES.some(p => pathname.startsWith(p))
}

export async function proxy(request: NextRequest) {
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
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // API defense-in-depth: user routes require Supabase Auth even if a future route forgets its own guard.
  // Cron remains exempt because it authenticates independently with CRON_SECRET.
  if (!user && pathname.startsWith('/api/') && !pathname.startsWith('/api/cron/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!user && pathname !== '/login' && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user) {
    // Bind the PIN-unlocked cookie to the current Supabase login session.
    const { data: { session } } = await supabase.auth.getSession()
    const supaSessionId = getSupabaseSessionId(session?.access_token)
    const pinCookie = request.cookies.get(PIN_SESSION_COOKIE_NAME)?.value
    const pinUnlocked = await verifyPinSessionValue(pinCookie, user.id, supaSessionId)

    if (pathname === '/login') {
      return NextResponse.redirect(new URL(pinUnlocked ? '/dashboard' : '/pin', request.url))
    }

    if (!pinUnlocked && pathname.startsWith('/api/') && !isPinExemptApi(pathname)) {
      return NextResponse.json({ error: 'PIN required' }, { status: 401 })
    }

    if (!pinUnlocked && !pathname.startsWith('/api/') && !PIN_EXEMPT_PAGES.includes(pathname)) {
      return NextResponse.redirect(new URL('/pin', request.url))
    }

    if (pinUnlocked && pathname === '/pin') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
