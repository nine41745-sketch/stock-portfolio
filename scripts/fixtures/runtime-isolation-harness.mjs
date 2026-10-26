import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import * as safety from '../../lib/supabase/runtime-safety.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
export const activeHost = 'active-portfolio.example.test'
export const stagedHost = 'synthetic-deployment.example.test'

export function fixture({ mode = 'production', host = stagedHost, env: changes = {}, forwardedHost } = {}) {
  const calls = { server: 0, browser: 0, service: 0, auth: 0, db: 0, secretReads: 0, providers: 0 }
  // A new object, never process.env. No cloud values or credentials are inherited.
  const env = new Proxy({
    VERCEL: '1', VERCEL_ENV: mode, VERCEL_URL: stagedHost,
    VERCEL_PROJECT_PRODUCTION_URL: activeHost,
    NEXT_PUBLIC_VERCEL_ENV: mode, NEXT_PUBLIC_VERCEL_URL: stagedHost,
    NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: activeHost,
    NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic-prod.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    CRON_SECRET: 'test-cron-secret', ...changes,
  }, { get(target, key) { if (key === 'CRON_SECRET') calls.secretReads++; return target[key] } })
  const forbidden = label => () => { calls.providers++; throw new Error(`Unexpected provider: ${label}`) }
  const headers = new Headers({ host, ...(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}) })
  const cookies = { getAll: () => [], get: () => undefined, set() {} }
  const auth = { getUser: async () => { calls.auth++; return { data: { user: null } } } }
  const sdk = kind => () => {
    calls[kind]++
    return { auth, from() { calls.db++; throw new Error('Unexpected synthetic DB operation') } }
  }
  const NextResponse = {
    json: (body, init) => Response.json(body, init),
    next: () => ({ status: 200, cookies: { set() {} } }),
    redirect: url => ({ status: 307, location: String(url) }),
  }
  const cache = new Map()
  const overrides = {
    'next/server': { NextResponse },
    'next/headers': { headers: async () => headers, cookies: async () => cookies },
    '@supabase/ssr': { createServerClient: sdk('server'), createBrowserClient: sdk('browser') },
    '@supabase/supabase-js': { createClient: sdk('service') },
    '@/lib/supabase/runtime-safety.mjs': safety,
    '@/lib/discovery-deadline': { createDeadlineFetch: forbidden('deadline fetch') },
    '@/lib/pin-session': { PIN_SESSION_COOKIE_NAME: 'synthetic-pin', getSupabaseSessionId: forbidden('session'), verifyPinSessionValue: forbidden('pin') },
    '@/lib/market-status': { getUsMarketClock: () => ({ isTradingDay: false, date: '2026-10-25' }), isPremarketCronWindow: () => false, PREMARKET_CRON_WINDOW: {} },
  }
  const deniedModules = new Set([
    '@/lib/portfolio-context', '@/lib/portfolio-batch', '@/lib/indicators', '@/lib/finnhub',
    '@/lib/news-relevance', '@/lib/analysis-execution-guard', '@/lib/synced-trade-context',
    '@/lib/premarket', '@/lib/premarket-trigger', '@/lib/latest-analysis', '@/types',
  ])
  const poison = new Proxy({}, { get: (_target, key) => forbidden(String(key)) })
  function load(relative) {
    assert(['proxy.ts', 'lib/supabase/server.ts', 'lib/supabase/client.ts',
      'app/api/cron/daily-analyze/route.ts', 'app/api/cron/premarket-analyze/route.ts'].includes(relative))
    if (cache.has(relative)) return cache.get(relative).exports
    const loadedModule = { exports: {} }
    cache.set(relative, loadedModule)
    const file = path.join(root, relative)
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const context = vm.createContext({
      module: loadedModule, exports: loadedModule.exports, process: Object.freeze({ env }), URL, Headers, Response,
      console: Object.freeze({ info() {}, error() {}, warn() {} }),
      window: Object.freeze({ location: Object.freeze({ host }) }),
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name]
        if (name === '@/lib/supabase/server') return load('lib/supabase/server.ts')
        if (deniedModules.has(name)) return poison
        throw new Error(`Import outside fixture allowlist: ${name}`)
      },
    }, { codeGeneration: { strings: false, wasm: false } })
    Object.defineProperty(context, 'fetch', { value: globalThis.fetch, writable: false, configurable: false })
    new vm.Script(compiled, { filename: file }).runInContext(context, { timeout: 3000 })
    return loadedModule.exports
  }
  function request(pathname = '/dashboard', authorization) {
    const requestHeaders = new Headers(headers)
    if (authorization !== undefined) requestHeaders.set('authorization', authorization)
    return { url: `https://${host}${pathname}`, nextUrl: new URL(`https://${host}${pathname}`), headers: requestHeaders, cookies }
  }
  return { load, calls, request }
}
