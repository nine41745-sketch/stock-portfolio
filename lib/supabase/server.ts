import { createDeadlineFetch, type DiscoveryProviderContext } from '@/lib/discovery-deadline'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies, headers } from 'next/headers'
import { assertSupabaseTargetIsSafe } from '@/lib/supabase/runtime-safety.mjs'

async function assertCurrentSupabaseTargetIsSafe() {
  const requestHeaders = await headers()
  assertSupabaseTargetIsSafe({
    isVercel: process.env.VERCEL === '1' || process.env.VERCEL_ENV !== undefined,
    deploymentEnv: process.env.VERCEL_ENV,
    requestHost: requestHeaders.get('host') ?? undefined,
    deploymentUrl: process.env.VERCEL_URL,
    projectProductionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    previewProjectRef: process.env.NEXT_PUBLIC_SUPABASE_PREVIEW_PROJECT_REF,
    productionProjectRef: process.env.NEXT_PUBLIC_SUPABASE_PRODUCTION_PROJECT_REF,
  })
}

export async function createClient(context?: DiscoveryProviderContext) {
  await assertCurrentSupabaseTargetIsSafe()
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Discovery owns retries through one absolute budget; SDK retry sleeps cannot escape it.
      ...(context ? { global: { fetch: createDeadlineFetch(context) }, db: { retry: false } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component ignore
          }
        },
      },
    }
  )
}

export async function createServiceClient() {
  await assertCurrentSupabaseTargetIsSafe()
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
