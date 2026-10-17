import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

// Execute the real resolver and Supabase query builder. Only the external
// PostgREST transport and Next request-cookie store are controlled here.
const compiled = ts.transpileModule(fs.readFileSync('lib/portfolio-context.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const portfolioId = '11111111-1111-4111-8111-111111111111'
const otherPortfolioId = '22222222-2222-4222-8222-222222222222'
const row = { id: portfolioId, name: 'Default', is_default: true, created_at: '2026-10-16T00:00:00Z' }

// Use the installed Next dedupe implementation and real React server cache.
// The dispatcher provides the request-scoped cache normally owned by the RSC renderer.
function requestMemoizedFetch(fetch) {
  const require = createRequire(import.meta.url)
  const react = require(path.join(path.dirname(require.resolve('react')), 'react.react-server.js'))
  const cache = new Map()
  react.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A = {
    getCacheForType(factory) {
      if (!cache.has(factory)) cache.set(factory, factory())
      return cache.get(factory)
    },
  }
  const file = require.resolve('next/dist/server/lib/dedupe-fetch')
  const localRequire = createRequire(file)
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))(
    name => name === 'react' ? react : localRequire(name), loaded, loaded.exports,
  )
  return loaded.exports.createDedupeFetch(fetch)
}

function harness(responses, cookieValue, memoized = false) {
  const requests = []
  const transport = async (input, init = {}) => {
    const url = new URL(String(input))
    assert.equal(url.pathname, '/rest/v1/portfolios')
    const method = init.method ?? 'GET'
    requests.push({ method, url, body: init.body ? JSON.parse(init.body) : null })
    const next = responses.shift()
    assert.ok(next, 'Unexpected extra database operation')
    assert.equal(method, next.method)
    if (method === 'GET') assert.equal(url.searchParams.get('user_id'), 'eq.user-a')
    if (method === 'POST') assert.deepEqual(JSON.parse(init.body), { user_id: 'user-a', name: 'เจน', is_default: true })
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  }
  const client = createClient('http://127.0.0.1:1', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: memoized ? requestMemoizedFetch(transport) : transport },
  })
  const loaded = { exports: {} }
  const diagnostics = []
  new Function('require', 'module', 'exports', 'console', compiled)(name => {
    if (name === 'next/headers') return { cookies: async () => ({ get: () => cookieValue ? { value: cookieValue } : undefined }) }
    if (name === '@/lib/supabase/server') return { createClient: async () => client }
    throw new Error(`Unexpected dependency: ${name}`)
  }, loaded, loaded.exports, { error: (...args) => diagnostics.push(args) })
  return { resolve: () => loaded.exports.resolveActivePortfolio('user-a', client), requests, responses, diagnostics }
}

const read = rows => ({ method: 'GET', body: rows })
const created = value => ({ method: 'POST', status: 201, body: value })
const failure = (code, method = 'POST') => ({ method, status: code === '23505' ? 409 : 403, body: { code, message: 'Synthetic database failure', details: null, hint: null } })

// Break caught: selecting an unowned/stale cookie or overwriting an existing
// account context while reconciling the current authenticated account.
test('owned portfolio list replaces a stale account cookie without creating a portfolio', async () => {
  const h = harness([read([row])], otherPortfolioId)
  const result = await h.resolve()
  assert.equal(result.portfolioId, portfolioId)
  assert.deepEqual(result.portfolios, [row])
  assert.equal(h.requests.length, 1)
})

test('first-time initialization returns the newly created owned default', async () => {
  const h = harness([read([]), created(row)])
  assert.equal((await h.resolve()).portfolioId, portfolioId)
  assert.equal(h.responses.length, 0)
})

// PostgreSQL serializes the unique-index conflict before returning 23505;
// the next statement may read the committed winner under READ COMMITTED.
test('concurrent first-time unique conflict reads the committed owned winner', async () => {
  const h = harness([read([]), failure('23505'), read([row])])
  assert.equal((await h.resolve()).portfolioId, portfolioId)
  assert.deepEqual(h.requests.map(request => request.method), ['GET', 'POST', 'GET'])
})

test('a failed initialization does not poison a later explicit account-context retry', async () => {
  const h = harness([read([]), failure('42501'), read([]), created(row)])
  await assert.rejects(h.resolve(), /PORTFOLIO_CONTEXT_CREATE_FAILED/)
  assert.equal((await h.resolve()).portfolioId, portfolioId)
  assert.equal(h.responses.length, 0)
})

test('concurrent conflict without an owned winner fails closed', async () => {
  const h = harness([read([]), failure('23505'), read([])])
  await assert.rejects(h.resolve(), /PORTFOLIO_CONTEXT_CREATE_FAILED/)
})

test('database permission failures never fall back to a legacy context', async () => {
  const h = harness([failure('42501', 'GET')])
  await assert.rejects(h.resolve(), /PORTFOLIO_CONTEXT_LOAD_FAILED/)
})

// Break caught: reusing the RSC memoized initial empty GET after PostgreSQL
// reports that a concurrent request committed the one permitted default.
test('concurrent first-time initialization bypasses the memoized empty ownership lookup', async () => {
  const h = harness([read([]), failure('23505'), read([row])], undefined, true)
  const result = await h.resolve()
  assert.equal(result.portfolioId, portfolioId)
  assert.deepEqual(result.portfolios, [row])
  assert.equal(h.responses.length, 0)
})
