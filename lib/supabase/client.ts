import { createBrowserClient } from '@supabase/ssr'
import { assertSupabaseTargetIsSafe } from '@/lib/supabase/runtime-safety.mjs'

export function createClient() {
  assertSupabaseTargetIsSafe({
    isVercel: process.env.NEXT_PUBLIC_VERCEL_ENV !== 'development',
    deploymentEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
    requestHost: typeof window !== 'undefined' ? window.location.host : undefined,
    deploymentUrl: process.env.NEXT_PUBLIC_VERCEL_URL,
    projectProductionUrl: process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    previewProjectRef: process.env.NEXT_PUBLIC_SUPABASE_PREVIEW_PROJECT_REF,
    productionProjectRef: process.env.NEXT_PUBLIC_SUPABASE_PRODUCTION_PROJECT_REF,
  })
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
