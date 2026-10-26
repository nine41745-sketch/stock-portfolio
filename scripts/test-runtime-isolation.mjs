import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import http from 'node:http'
import https from 'node:https'
import http2 from 'node:http2'
import net from 'node:net'
import tls from 'node:tls'
import dns from 'node:dns'
import dgram from 'node:dgram'
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { fixture, activeHost, stagedHost, cronTargetHost } from './fixtures/runtime-isolation-harness.mjs'

const boundary = globalThis[Symbol.for('stock-portfolio.test-network-deny')]
assert.ok(boundary, 'Run with --require ./scripts/fixtures/runtime-isolation-network-deny.cjs; never run unguarded')
after(() => assert.equal(boundary.snapshot().length, 13, 'Only the 13 deliberate transport self-probes may attempt network/process creation'))

test('Network boundary blocks transports and process escapes before any OS connection', () => {
  const probes = [
    () => fetch('https://network-probe.invalid'),
    () => http.get('http://network-probe.invalid'),
    () => https.request('https://network-probe.invalid'),
    () => http2.connect('https://network-probe.invalid'),
    () => net.connect({ host: 'network-probe.invalid', port: 443 }),
    () => new net.Socket().connect(443, 'network-probe.invalid'),
    () => tls.connect({ host: 'network-probe.invalid', port: 443 }),
    () => dns.lookup('network-probe.invalid', () => {}),
    () => new dns.Resolver().resolve('network-probe.invalid', () => {}),
    () => dgram.createSocket('udp4'),
    () => new WebSocket('wss://network-probe.invalid'),
    () => spawn('not-executed'),
    () => new Worker('not-executed'),
  ]
  const before = boundary.snapshot().length
  for (const probe of probes) assert.throws(probe, { code: 'ERR_TEST_NETWORK_DENIED' })
  assert.equal(boundary.snapshot().length - before, probes.length)
})

const denied = [
  ['Staged Production deployment URL', {}],
  ['Preview without project refs', { mode: 'preview' }],
  ['Preview equal project refs', { mode: 'preview', env: { NEXT_PUBLIC_SUPABASE_PREVIEW_PROJECT_REF: 'synthetic-prod', NEXT_PUBLIC_SUPABASE_PRODUCTION_PROJECT_REF: 'synthetic-prod' } }],
  ['Preview pointing to different project', { mode: 'preview', env: { NEXT_PUBLIC_SUPABASE_PREVIEW_PROJECT_REF: 'synthetic-preview', NEXT_PUBLIC_SUPABASE_PRODUCTION_PROJECT_REF: 'synthetic-prod' } }],
  ['Unknown environment', { mode: 'unknown' }],
  ['Missing deployment URL', { host: activeHost, env: { VERCEL_URL: '', NEXT_PUBLIC_VERCEL_URL: '' } }],
  ['Forwarded active Host on staged URL', { forwardedHost: activeHost }],
]
for (const [name, options] of denied) test(`${name}: proxy and factories reject before SDK/Auth/DB`, async () => {
  const before = boundary.snapshot().length
  const f = fixture(options)
  const result = await f.load('proxy.ts').proxy(f.request())
  assert.equal(result.status, 503)
  assert.equal((await result.json()).error, 'Backend isolation is not configured')
  const server = f.load('lib/supabase/server.ts')
  await assert.rejects(server.createClient(), /not isolated/)
  await assert.rejects(server.createServiceClient(), /not isolated/)
  assert.throws(() => f.load('lib/supabase/client.ts').createClient(), /not isolated/)
  assert.deepEqual(f.calls, {
    server: 0, browser: 0, service: 0, auth: 0, db: 0, secretReads: 0, providers: 0,
    identityFetch: ['Staged Production deployment URL', 'Missing deployment URL', 'Forwarded active Host on staged URL'].includes(name) ? 3 : 0,
  })
  assert.equal(boundary.snapshot().length, before, 'No attempted outbound network in runtime cases')
})

for (const file of ['app/api/cron/daily-analyze/route.ts', 'app/api/cron/premarket-analyze/route.ts']) {
  for (const [name, options] of denied) test(`${file} / ${name}: rejects before Cron secret and SDK`, async () => {
    const before = boundary.snapshot().length
    const f = fixture(options)
    const response = await f.load(file).GET(f.request('/api/cron/synthetic'))
    assert.equal(response.status, 404)
    assert.equal(f.calls.secretReads, 0)
    assert.equal(f.calls.service, 0)
    assert.equal(f.calls.auth, 0)
    assert.equal(f.calls.db, 0)
    assert.equal(f.calls.providers, 0)
    assert.equal(boundary.snapshot().length, before)
  })
  for (const secret of [undefined, 'wrong-secret', 'synthetic-cron-secret']) test(`${file}: active-host mock retains Cron auth (${secret ?? 'missing'})`, async () => {
    const f = fixture({ host: activeHost, env: { CRON_SECRET: secret } })
    const authorization = secret === 'synthetic-cron-secret' ? `Bearer ${secret}` : 'Bearer wrong'
    const response = await f.load(file).GET(f.request('/api/cron/synthetic', authorization))
    // Valid mock credentials stop at a synthetic non-trading-day branch, never a real query.
    assert.equal(response.status, secret === undefined ? 503 : secret === 'wrong-secret' ? 401 : 200)
    assert.equal(f.calls.service, 0)
    assert.equal(f.calls.db, 0)
  })

  test(`${file}: registered Cron host is accepted only for the deployment verified behind Production`, async () => {
    const f = fixture({
      host: cronTargetHost,
      identityDeploymentId: 'dpl-synthetic-active',
      env: {
        VERCEL_URL: cronTargetHost,
        VERCEL_DEPLOYMENT_ID: 'dpl-synthetic-active',
        CRON_SECRET: 'test-cron-secret',
      },
    })
    const proxyResult = await f.load('proxy.ts').proxy(f.request('/api/cron/synthetic'))
    assert.equal(proxyResult.status, 200, 'Proxy must accept the current deployment when its identity matches the Production alias')
    const response = await f.load(file).GET(f.request('/api/cron/synthetic', 'Bearer test-cron-secret'))
    assert.equal(response.status, 200, 'Synthetic non-trading-day control should pass only after Production identity and Cron secret checks')
    assert.equal(f.calls.identityFetch, 2, 'Proxy and route must each verify the active deployment identity')
    assert.equal(f.calls.secretReads, 1)
    assert.equal(f.calls.service, 0)
    assert.equal(f.calls.db, 0)
    assert.equal(f.calls.providers, 0)
  })

  test(`${file}: staged deployment identity mismatch rejects before secret or service client`, async () => {
    const f = fixture({
      host: stagedHost,
      identityDeploymentId: 'dpl-synthetic-active',
      env: { VERCEL_URL: stagedHost, VERCEL_DEPLOYMENT_ID: 'dpl-synthetic-staged' },
    })
    const response = await f.load(file).GET(f.request('/api/cron/synthetic', 'Bearer test-cron-secret'))
    assert.equal(response.status, 404)
    assert.equal(f.calls.secretReads, 0)
    assert.equal(f.calls.service, 0)
    assert.equal(f.calls.db, 0)
    assert.equal(f.calls.providers, 0)
  })

  test(`${file}: explicitly approved Preview branch still cannot invoke Production Cron`, async () => {
    const approvedHost = 'pr115-preview.vercel.app'
    const f = fixture({
      mode: 'preview',
      host: approvedHost,
      env: {
        VERCEL_URL: approvedHost,
        NEXT_PUBLIC_VERCEL_URL: approvedHost,
        VERCEL_GIT_COMMIT_REF: 'codex/active-production-identity',
        NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: 'codex/active-production-identity',
        NEXT_PUBLIC_SUPABASE_PREVIEW_PRODUCTION_ACCESS_BRANCH: 'codex/active-production-identity',
        NEXT_PUBLIC_SUPABASE_PRODUCTION_PROJECT_REF: 'prodproject123456789',
        NEXT_PUBLIC_SUPABASE_URL: 'https://prodproject123456789.supabase.co',
        CRON_SECRET: 'test-cron-secret',
      },
    })
    const response = await f.load(file).GET(f.request('/api/cron/synthetic', 'Bearer test-cron-secret'))
    assert.equal(response.status, 404)
    assert.equal(f.calls.secretReads, 0)
    assert.equal(f.calls.service, 0)
    assert.equal(f.calls.db, 0)
    assert.equal(f.calls.providers, 0)
  })

  test(`${file}: unavailable Production identity fails closed before Cron secret`, async () => {
    const f = fixture({
      host: cronTargetHost,
      identityStatus: 503,
      env: { VERCEL_URL: cronTargetHost, VERCEL_DEPLOYMENT_ID: 'dpl-synthetic-active' },
    })
    const response = await f.load(file).GET(f.request('/api/cron/synthetic', 'Bearer test-cron-secret'))
    assert.equal(response.status, 404)
    assert.equal(f.calls.secretReads, 0)
    assert.equal(f.calls.service, 0)
    assert.equal(f.calls.db, 0)
    assert.equal(f.calls.providers, 0)
  })
}

test('Production identity endpoint returns only the deployment ID with no-store caching', async () => {
  const f = fixture({ env: { VERCEL_DEPLOYMENT_ID: 'dpl-synthetic-current' } })
  const response = await f.load('app/api/internal/deployment-identity/route.ts').GET()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { deploymentId: 'dpl-synthetic-current' })
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  assert.equal(f.calls.auth, 0)
  assert.equal(f.calls.db, 0)
  assert.equal(f.calls.secretReads, 0)
})

test('Production identity endpoint fails closed when Vercel provides no deployment ID', async () => {
  const f = fixture({ env: { VERCEL_DEPLOYMENT_ID: '' } })
  const response = await f.load('app/api/internal/deployment-identity/route.ts').GET()
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'Deployment identity unavailable' })
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  assert.equal(f.calls.auth, 0)
  assert.equal(f.calls.db, 0)
  assert.equal(f.calls.secretReads, 0)
})

for (const options of [
  { host: activeHost },
  { mode: 'preview', env: { NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic-preview.supabase.co', NEXT_PUBLIC_SUPABASE_PREVIEW_PROJECT_REF: 'synthetic-preview', NEXT_PUBLIC_SUPABASE_PRODUCTION_PROJECT_REF: 'synthetic-prod' } },
]) test(`${options.mode ?? 'production'} allowed mock control exercises actual factories and proxy`, async () => {
  const before = boundary.snapshot().length
  const f = fixture(options)
  const server = f.load('lib/supabase/server.ts')
  await server.createClient()
  await server.createServiceClient()
  f.load('lib/supabase/client.ts').createClient()
  const result = await f.load('proxy.ts').proxy(f.request())
  assert.equal(result.status, 307)
  assert.equal(result.location, `https://${options.host ?? stagedHost}/login`)
  assert.equal(f.calls.server, 2)
  assert.equal(f.calls.service, 1)
  assert.equal(f.calls.browser, 1)
  assert.equal(f.calls.auth, 1)
  assert.equal(f.calls.db, 0)
  assert.equal(boundary.snapshot().length, before)
})

test('An allowlisted synthetic Host permits factories; this does not attest deployed identity', async () => {
  const f = fixture({ host: activeHost })
  await f.load('lib/supabase/server.ts').createServiceClient()
  assert.equal(f.calls.service, 1)
  assert.equal(f.calls.db, 0)
})

test('Only the branch-scoped approved Preview may use the Production target; this is synthetic and performs no DB operation', async () => {
  const approvedHost = 'pr115-preview.vercel.app'
  const before = boundary.snapshot().length
  const f = fixture({
    mode: 'preview',
    host: approvedHost,
    env: {
      VERCEL_URL: approvedHost,
      NEXT_PUBLIC_VERCEL_URL: approvedHost,
      VERCEL_GIT_COMMIT_REF: 'codex/active-production-identity',
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: 'codex/active-production-identity',
      NEXT_PUBLIC_SUPABASE_PREVIEW_PRODUCTION_ACCESS_BRANCH: 'codex/active-production-identity',
      NEXT_PUBLIC_SUPABASE_PRODUCTION_PROJECT_REF: 'prodproject123456789',
      NEXT_PUBLIC_SUPABASE_URL: 'https://prodproject123456789.supabase.co',
    },
  })
  const server = f.load('lib/supabase/server.ts')
  await server.createClient()
  await server.createServiceClient()
  f.load('lib/supabase/client.ts').createClient()
  const result = await f.load('proxy.ts').proxy(f.request())
  assert.equal(result.status, 307)
  assert.equal(result.location, `https://${approvedHost}/login`)
  assert.equal(f.calls.server, 2)
  assert.equal(f.calls.service, 1)
  assert.equal(f.calls.browser, 1)
  assert.equal(f.calls.auth, 1)
  assert.equal(f.calls.db, 0, 'The synthetic SDK must not execute any database operation')
  assert.equal(boundary.snapshot().length, before, 'No outbound network is permitted')
})
