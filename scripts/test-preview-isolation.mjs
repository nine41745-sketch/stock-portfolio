import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSupabaseTargetIsSafe,
  isProductionCronEnvironment,
  isCurrentProductionDeployment,
  assertSupabaseTargetIsSafeForServer,
  isProductionCronRequestAllowed,
} from '../lib/supabase/runtime-safety.mjs'

const syntheticRef = 'synthetic-project-1234'
const productionRef = 'prodproject123456789'
const productionHost = 'portfolio.example.test'
const stagedHost = 'portfolio-preview-123.vercel.app'
const previewConfig = {
  isVercel: true,
  deploymentEnv: 'preview',
  previewProjectRef: syntheticRef,
  productionProjectRef: productionRef,
}

assert.throws(
  () => assertSupabaseTargetIsSafe({ ...previewConfig, previewProjectRef: undefined }),
  /not isolated/,
  'Preview must fail closed until its synthetic project ref is configured'
)
assert.throws(
  () => assertSupabaseTargetIsSafe({ ...previewConfig, supabaseUrl: `https://${productionRef}.supabase.co` }),
  /not isolated/,
  'Preview must reject a Production Supabase endpoint'
)
assert.throws(
  () => assertSupabaseTargetIsSafe({ ...previewConfig, previewProjectRef: productionRef, supabaseUrl: `https://${productionRef}.supabase.co` }),
  /not isolated/,
  'Preview must reject an allowlist that equals the Production project'
)
assert.throws(
  () => assertSupabaseTargetIsSafe({ ...previewConfig, supabaseUrl: 'https://other-project.supabase.co' }),
  /not isolated/,
  'Preview must reject a Supabase endpoint outside its exact synthetic project ref'
)
assert.throws(
  () => assertSupabaseTargetIsSafe({ ...previewConfig, supabaseUrl: 'https://synthetic-project-1234.supabase.co.evil.example' }),
  /not isolated/,
  'Preview must reject hostname suffix tricks'
)
assert.doesNotThrow(
  () => assertSupabaseTargetIsSafe({ ...previewConfig, supabaseUrl: `https://${syntheticRef}.supabase.co` }),
  'Preview may connect only to its separately allowlisted synthetic project'
)
const explicitlyApprovedPreviewProductionConfig = {
  ...previewConfig,
  requestHost: stagedHost,
  deploymentUrl: stagedHost,
  projectProductionUrl: productionHost,
  supabaseUrl: `https://${productionRef}.supabase.co`,
  previewProductionAccessBranch: 'codex/active-production-identity',
  gitCommitRef: 'codex/active-production-identity',
}
assert.doesNotThrow(
  () => assertSupabaseTargetIsSafe(explicitlyApprovedPreviewProductionConfig),
  'Only the explicitly approved Preview branch may use its exact Production Supabase target'
)
for (const [overrides, reason] of [
  [{ gitCommitRef: 'other-preview-branch' }, 'a different Preview branch must not use Production Supabase'],
  [{ previewProductionAccessBranch: 'other-preview-branch', gitCommitRef: 'other-preview-branch' }, 'the opt-in cannot authorize a branch outside this owner-approved task'],
  [{ requestHost: 'attacker.example.test' }, 'a request outside its deployment hostname must not use Production Supabase'],
  [{ requestHost: productionHost, deploymentUrl: productionHost }, 'the Production hostname must not be treated as an approved Preview'],
  [{ supabaseUrl: 'https://other-project.supabase.co' }, 'the approved Production access branch must not silently use a different target'],
  [{ productionProjectRef: undefined }, 'Preview Production access must fail closed without an exact Production project ref'],
  [{ previewProductionAccessBranch: undefined }, 'Preview Production access must fail closed without a branch-scoped opt-in'],
]) {
  assert.throws(
    () => assertSupabaseTargetIsSafe({ ...explicitlyApprovedPreviewProductionConfig, ...overrides }),
    /not isolated/,
    reason
  )
}
await assert.doesNotReject(
  () => assertSupabaseTargetIsSafeForServer(explicitlyApprovedPreviewProductionConfig),
  'The server guard must honor only the explicit, exact-target Preview branch opt-in'
)
await assert.rejects(
  () => assertSupabaseTargetIsSafeForServer({
    ...explicitlyApprovedPreviewProductionConfig,
    gitCommitRef: 'unapproved-branch',
  }),
  /not isolated/,
  'The server guard must reject Production Supabase from any other Preview branch'
)
assert.doesNotThrow(
  () => assertSupabaseTargetIsSafe({
    isVercel: true,
    deploymentEnv: 'production',
    requestHost: productionHost,
    deploymentUrl: 'stock-portfolio-abc123-nine41745.vercel.app',
    projectProductionUrl: productionHost,
    supabaseUrl: 'https://production.supabase.co',
  }),
  'Active Production requests on the Vercel project Production URL must retain database access'
)
assert.doesNotThrow(
  () => assertSupabaseTargetIsSafe({
    isVercel: true,
    deploymentEnv: 'production',
    requestHost: productionHost,
    deploymentUrl: 'portfolio-deploy-abc123.vercel.app',
    projectProductionUrl: 'legacy-project-domain.example.test',
    activeProductionHosts: [productionHost],
    supabaseUrl: 'https://production.supabase.co',
  }),
  'A separately verified active Production alias must remain available if Vercel selects a different project Production URL'
)
assert.throws(
  () => assertSupabaseTargetIsSafe({
    isVercel: true,
    deploymentEnv: 'production',
    requestHost: stagedHost,
    deploymentUrl: stagedHost,
    projectProductionUrl: productionHost,
    supabaseUrl: 'https://production.supabase.co',
  }),
  /not isolated/,
  'Staged Production deployments must not use Production Supabase, even when VERCEL_ENV is production'
)
assert.throws(
  () => assertSupabaseTargetIsSafe({
    isVercel: true,
    deploymentEnv: 'production',
    requestHost: productionHost,
    deploymentUrl: stagedHost,
    projectProductionUrl: undefined,
    supabaseUrl: 'https://production.supabase.co',
  }),
  /not isolated/,
  'Production must fail closed when Vercel cannot prove the configured project Production URL'
)
assert.throws(
  () => assertSupabaseTargetIsSafe({
    isVercel: true,
    deploymentEnv: 'production',
    requestHost: 'unrelated.example',
    deploymentUrl: stagedHost,
    projectProductionUrl: productionHost,
    supabaseUrl: 'https://production.supabase.co',
  }),
  /not isolated/,
  'Production must reject hosts other than the project Production URL'
)
assert.throws(
  () => assertSupabaseTargetIsSafe({ ...previewConfig, deploymentEnv: 'unknown', supabaseUrl: `https://${syntheticRef}.supabase.co` }),
  /not isolated/,
  'Unknown Vercel environments must fail closed'
)
assert.doesNotThrow(
  () => assertSupabaseTargetIsSafe({ isVercel: false, deploymentEnv: 'development', supabaseUrl: 'http://127.0.0.1:54321' }),
  'Local development behavior must remain available'
)

assert.equal(isProductionCronEnvironment({
  deploymentEnv: 'production', requestHost: productionHost,
  deploymentUrl: 'stock-portfolio-abc123-nine41745.vercel.app', projectProductionUrl: productionHost,
}), true)
assert.equal(isProductionCronEnvironment({
  deploymentEnv: 'production', requestHost: stagedHost,
  deploymentUrl: stagedHost, projectProductionUrl: productionHost,
}), false)
assert.equal(isProductionCronEnvironment({ deploymentEnv: 'production' }), false)
assert.equal(isProductionCronEnvironment({ deploymentEnv: 'preview' }), false)
assert.equal(isProductionCronEnvironment({ deploymentEnv: undefined }), false)
assert.equal(isProductionCronEnvironment({ deploymentEnv: 'unknown' }), false)
assert.equal(await isProductionCronRequestAllowed({
  ...explicitlyApprovedPreviewProductionConfig,
  deploymentEnv: 'preview',
}), false, 'Preview Cron must stay blocked even when this Preview may use Production Supabase')

const activeDeploymentIdentity = {
  deploymentEnv: 'production',
  deploymentId: 'dpl-synthetic-active',
  projectProductionUrl: productionHost,
}
let identityFetchCalls = 0
const identityFetch = async (url, options) => {
  identityFetchCalls++
  assert.equal(String(url), `https://${productionHost}/api/internal/deployment-identity`)
  assert.equal(options.cache, 'no-store')
  assert.equal(options.redirect, 'error')
  return Response.json({ deploymentId: 'dpl-synthetic-active' })
}
assert.equal(await isCurrentProductionDeployment({ ...activeDeploymentIdentity, fetchImpl: identityFetch }), true,
  'Active Production deployment identity must be confirmed from the project Production URL')
assert.equal(await isCurrentProductionDeployment({
  ...activeDeploymentIdentity, deploymentId: 'dpl-synthetic-staged', fetchImpl: identityFetch,
}), false, 'A staged Production-target deployment must fail when its ID differs from the Production alias')
const callsBeforePreviewIdentity = identityFetchCalls
assert.equal(await isCurrentProductionDeployment({
  ...activeDeploymentIdentity, deploymentEnv: 'preview', fetchImpl: identityFetch,
}), false, 'Preview must not use Production identity as authorization')
assert.equal(identityFetchCalls, callsBeforePreviewIdentity, 'Preview must fail before requesting Production identity')
assert.equal(await isCurrentProductionDeployment({
  ...activeDeploymentIdentity,
  fetchImpl: async () => new Response('unavailable', { status: 503 }),
}), false, 'Unavailable Production identity must fail closed')
assert.equal(await isCurrentProductionDeployment({
  ...activeDeploymentIdentity,
  fetchImpl: async () => Response.json({ deploymentId: 'dpl-synthetic-other' }),
}), false, 'A different active Production deployment must not authorize this deployment')
assert.equal(await isCurrentProductionDeployment({
  ...activeDeploymentIdentity,
  projectProductionUrl: 'https://user:pass@portfolio.example.test/private',
  fetchImpl: identityFetch,
}), false, 'Identity lookup must reject credentials or paths in the configured Production URL')
assert.equal(await isCurrentProductionDeployment({
  ...activeDeploymentIdentity,
  fetchImpl: async () => new Response('{"deploymentId":"dpl-synthetic-active"}', {
    status: 302, headers: { 'content-type': 'application/json' },
  }),
}), false, 'Identity lookup must reject redirects')

// Both fixed Production aliases must still require the active deployment identity.
for (const requestHost of ['stock-portfolio-nine41745.vercel.app', 'stock-portfolio-seven-inky.vercel.app']) {
  const config = { isVercel: true, ...activeDeploymentIdentity, requestHost, deploymentUrl: stagedHost, fetchImpl: identityFetch }
  await assert.doesNotReject(() => assertSupabaseTargetIsSafeForServer(config), `${requestHost} must permit active deployment`)
  await assert.rejects(() => assertSupabaseTargetIsSafeForServer({ ...config, deploymentId: 'dpl-synthetic-staged' }), /not isolated/, `${requestHost} must reject staged identity`)
  assert.equal(await isProductionCronRequestAllowed({ ...config, deploymentId: 'dpl-synthetic-staged' }), false, `${requestHost} must reject staged Cron`)
}

await assert.doesNotReject(() => assertSupabaseTargetIsSafeForServer({
  isVercel: true,
  deploymentEnv: 'production',
  requestHost: 'cron-target.example.test',
  deploymentUrl: 'cron-target.example.test',
  projectProductionUrl: productionHost,
  deploymentId: 'dpl-synthetic-active',
  supabaseUrl: 'https://production.supabase.co',
  fetchImpl: identityFetch,
}), 'A Cron request addressed to the active deployment URL must pass the identity check')
await assert.rejects(() => assertSupabaseTargetIsSafeForServer({
  isVercel: true,
  deploymentEnv: 'production',
  requestHost: stagedHost,
  deploymentUrl: stagedHost,
  projectProductionUrl: productionHost,
  deploymentId: 'dpl-synthetic-staged',
  supabaseUrl: 'https://production.supabase.co',
  fetchImpl: identityFetch,
}), /not isolated/, 'A Staged Production deployment must fail before Supabase access')
await assert.rejects(() => assertSupabaseTargetIsSafeForServer({
  isVercel: true,
  deploymentEnv: 'production',
  requestHost: productionHost,
  deploymentUrl: stagedHost,
  projectProductionUrl: productionHost,
  deploymentId: 'dpl-synthetic-staged',
  supabaseUrl: 'https://production.supabase.co',
  fetchImpl: identityFetch,
}), /not isolated/, 'A Staged deployment must not access Production Supabase by presenting the Production Host header')
assert.equal(await isProductionCronRequestAllowed({
  ...activeDeploymentIdentity,
  requestHost: 'cron-target.example.test',
  deploymentUrl: 'cron-target.example.test',
  fetchImpl: identityFetch,
}), true, 'A Cron targeting the deployment currently behind the Production URL must be accepted')
assert.equal(await isProductionCronRequestAllowed({
  ...activeDeploymentIdentity,
  requestHost: productionHost,
  deploymentUrl: stagedHost,
  deploymentId: 'dpl-synthetic-staged',
  fetchImpl: identityFetch,
}), false, 'A Staged deployment must not be authorized for Cron by presenting the Production Host header')
assert.equal(await isProductionCronRequestAllowed({
  ...activeDeploymentIdentity,
  requestHost: productionHost,
  deploymentUrl: stagedHost,
  deploymentId: undefined,
  fetchImpl: identityFetch,
}), false, 'A Production Host must not authorize Cron when deployment identity is unavailable')
assert.equal(await isProductionCronRequestAllowed({
  ...activeDeploymentIdentity,
  deploymentId: 'dpl-synthetic-staged',
  requestHost: stagedHost,
  deploymentUrl: stagedHost,
  fetchImpl: identityFetch,
}), false, 'A staged Cron invocation must remain rejected')

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertGuardBeforeFactory(file, functionMarker, guard, factory) {
  const text = source(file)
  const functionIndex = text.indexOf(functionMarker)
  const guardIndex = text.indexOf(guard, functionIndex)
  const factoryIndex = text.indexOf(factory, functionIndex)
  assert.ok(functionIndex >= 0, `${file} must retain the guarded function`)
  assert.ok(guardIndex >= 0, `${file} must use the shared Supabase safety guard`)
  assert.ok(factoryIndex >= 0, `${file} must retain the expected client factory`)
  assert.ok(guardIndex < factoryIndex, `${file} must validate the target before creating a Supabase client`)
}

assertGuardBeforeFactory('lib/supabase/server.ts', 'export async function createClient', 'assertCurrentSupabaseTargetIsSafe()', 'createServerClient(')
assertGuardBeforeFactory('lib/supabase/server.ts', 'export async function createServiceClient', 'assertCurrentSupabaseTargetIsSafe()', 'createSupabaseClient(')
assertGuardBeforeFactory('lib/supabase/client.ts', 'export function createClient', 'assertSupabaseTargetIsSafe', 'createBrowserClient(')
assertGuardBeforeFactory('proxy.ts', 'export async function proxy', 'assertSupabaseTargetIsSafe', 'createServerClient(')

for (const file of ['lib/supabase/server.ts', 'proxy.ts']) {
  const text = source(file)
  assert.match(text, /requestHost:/, `${file} must provide the request host to the Production identity guard`)
  assert.match(text, /process\.env\.VERCEL_URL/, `${file} must provide Vercel's deployment-specific URL`)
  assert.match(text, /process\.env\.VERCEL_PROJECT_PRODUCTION_URL/, `${file} must provide Vercel's project Production URL`)
  assert.match(text, /process\.env\.VERCEL_DEPLOYMENT_ID/, `${file} must provide the current platform deployment identity`)
}
assert.match(source('lib/supabase/server.ts'), /gitCommitRef: process\.env\.VERCEL_GIT_COMMIT_REF/)
assert.match(source('proxy.ts'), /gitCommitRef: process\.env\.VERCEL_GIT_COMMIT_REF/)
const browserClient = source('lib/supabase/client.ts')
assert.match(browserClient, /window\.location\.host/, 'Browser Supabase access must check the current request host')
assert.match(browserClient, /NEXT_PUBLIC_VERCEL_URL/, 'Browser Supabase access must know the deployment-specific URL')
assert.match(browserClient, /NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL/, 'Browser Supabase access must know the project Production URL')
assert.match(browserClient, /NEXT_PUBLIC_SUPABASE_PREVIEW_PRODUCTION_ACCESS_BRANCH/, 'Browser Production access must require a branch-scoped opt-in')
assert.match(browserClient, /NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF/, 'Browser Production access must compare the current Git branch to that opt-in')

for (const [file, factory] of [
  ['app/api/cron/daily-analyze/route.ts', 'createServiceClient()'],
  ['app/api/cron/premarket-analyze/route.ts', 'createServiceClient()'],
]) {
  const text = source(file)
  const gateIndex = text.indexOf('isProductionCronRequestAllowed({')
  const credentialBoundaryIndex = text.indexOf('process.env.CRON_SECRET')
  const factoryIndex = text.indexOf(factory)
  assert.ok(gateIndex >= 0 && gateIndex < credentialBoundaryIndex && gateIndex < factoryIndex, `${file} must reject non-Production invocations before secrets or Supabase access`)
}

const identityRoute = source('app/api/internal/deployment-identity/route.ts')
assert.match(identityRoute, /VERCEL_DEPLOYMENT_ID/, 'The identity endpoint must read only the platform deployment identifier')
assert.match(identityRoute, /cache-control.*no-store/, 'The identity endpoint must disable caching')
assert.doesNotMatch(identityRoute, /SUPABASE|CRON_SECRET|DATABASE_URL/i, 'The identity endpoint must not access credentials or the database')
assert.match(source('proxy.ts'), /api\/internal\/deployment-identity/, 'The identity endpoint must bypass the Supabase/Auth proxy to prevent recursion')

const vercelConfig = JSON.parse(source('vercel.json'))
for (const cron of vercelConfig.crons ?? []) {
  const file = `app${cron.path}/route.ts`
  const text = source(file)
  const gateIndex = text.indexOf('isProductionCronRequestAllowed({')
  const credentialBoundaryIndex = text.indexOf('process.env.CRON_SECRET')
  const factoryIndex = text.indexOf('createServiceClient()')
  assert.ok(gateIndex >= 0 && gateIndex < credentialBoundaryIndex && gateIndex < factoryIndex, `${file} registered in vercel.json must deny non-Production requests before any Supabase access`)
}

const nextConfig = source('next.config.js')
assert.match(nextConfig, /NEXT_PUBLIC_VERCEL_ENV/)
assert.match(nextConfig, /process\.env\.VERCEL_ENV/)
assert.match(nextConfig, /unknown/)
assert.match(nextConfig, /NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF/)
assert.match(nextConfig, /NEXT_PUBLIC_SUPABASE_PREVIEW_PRODUCTION_ACCESS_BRANCH/)
const safetySource = source('lib/supabase/runtime-safety.mjs')
assert.match(safetySource, /stock-portfolio-nine41745\.vercel\.app/, 'The currently verified active Production alias must remain allowlisted')

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [path] : []
  })
}

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
const directSupabaseImports = walk(join(sourceRoot, 'app'))
  .concat(walk(join(sourceRoot, 'lib')), walk(join(sourceRoot, 'components')), [join(sourceRoot, 'proxy.ts')])
  .filter(file => readFileSync(file, 'utf8').split(/\r?\n/).some(line =>
    /^\s*import(?!\s+type)\s+.*from\s*['"]@supabase\/(ssr|supabase-js)['"]/.test(line)
  ))
  .map(file => file.slice(sourceRoot.length).replaceAll('\\', '/'))
  .filter(file => !['lib/supabase/server.ts', 'lib/supabase/client.ts', 'proxy.ts'].includes(file))
assert.deepEqual(directSupabaseImports, [], 'All runtime Supabase clients must flow through the guarded factories')

console.log('Preview isolation regression checks passed.')
