const UNSAFE_TARGET_MESSAGE = 'Supabase target is not isolated for this Vercel environment'
export const ACTIVE_PRODUCTION_IDENTITY_PATH = '/api/internal/deployment-identity'
// Verified read-only from Vercel: this alias currently maps to the active Production deployment.
const ACTIVE_PRODUCTION_HOSTS = ['stock-portfolio-nine41745.vercel.app']

function normalizeHost(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

function normalizeProductionIdentityHost(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) return null
    return parsed.hostname.toLowerCase()
  } catch {
    return null
  }
}

function isActiveProductionRequest({ requestHost, deploymentUrl, projectProductionUrl, activeProductionHosts = ACTIVE_PRODUCTION_HOSTS }) {
  const requestHostname = normalizeHost(requestHost)
  const deploymentHostname = normalizeHost(deploymentUrl)
  const productionHostnames = [projectProductionUrl, ...activeProductionHosts].map(normalizeHost).filter(Boolean)
  return Boolean(
    requestHostname && deploymentHostname && productionHostnames.includes(requestHostname) &&
    requestHostname !== deploymentHostname
  )
}

/**
 * Fail closed on Vercel unless Preview is tied to a non-Production Supabase
 * project or Production traffic uses a verified project Production host.
 * Project refs and hostnames are identifiers, not secrets.
 *
 * @param {{ isVercel: boolean, deploymentEnv?: string, requestHost?: string, deploymentUrl?: string, projectProductionUrl?: string, activeProductionHosts?: string[], supabaseUrl?: string, previewProjectRef?: string, productionProjectRef?: string }} options
 */
export function assertSupabaseTargetIsSafe({
  isVercel,
  deploymentEnv,
  requestHost,
  deploymentUrl,
  projectProductionUrl,
  activeProductionHosts,
  supabaseUrl,
  previewProjectRef,
  productionProjectRef,
}) {
  if (!isVercel) return
  if (deploymentEnv === 'production') {
    if (!isActiveProductionRequest({ requestHost, deploymentUrl, projectProductionUrl, activeProductionHosts })) {
      throw new Error(UNSAFE_TARGET_MESSAGE)
    }
    return
  }
  if (deploymentEnv !== 'preview') throw new Error(UNSAFE_TARGET_MESSAGE)
  if (!previewProjectRef || !productionProjectRef || previewProjectRef === productionProjectRef) {
    throw new Error(UNSAFE_TARGET_MESSAGE)
  }

  let targetUrl
  try {
    targetUrl = new URL(supabaseUrl ?? '')
  } catch {
    throw new Error(UNSAFE_TARGET_MESSAGE)
  }

  if (
    targetUrl.protocol !== 'https:' ||
    targetUrl.hostname !== `${previewProjectRef}.supabase.co` ||
    previewProjectRef === productionProjectRef
  ) {
    throw new Error(UNSAFE_TARGET_MESSAGE)
  }
}

/**
 * Identify the deployment currently serving the project's Production URL.
 * The endpoint exposes only VERCEL_DEPLOYMENT_ID and is deliberately uncached.
 * Failure, redirects, non-JSON responses, and mismatches all fail closed.
 *
 * @param {{ deploymentEnv?: string, deploymentId?: string, projectProductionUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export async function isCurrentProductionDeployment({
  deploymentEnv,
  deploymentId,
  projectProductionUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 1500,
} = {}) {
  if (deploymentEnv !== 'production' || typeof deploymentId !== 'string' || !deploymentId.trim()) return false
  if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return false
  const hostname = normalizeProductionIdentityHost(projectProductionUrl)
  if (!hostname) return false

  try {
    const endpoint = new URL(ACTIVE_PRODUCTION_IDENTITY_PATH, `https://${hostname}`)
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) return false
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > 512) return false
    const identity = await response.json()
    return Boolean(identity && typeof identity.deploymentId === 'string' && identity.deploymentId === deploymentId)
  } catch {
    return false
  }
}

/** Server-side counterpart to the synchronous browser guard. */
export async function assertSupabaseTargetIsSafeForServer(options) {
  try {
    assertSupabaseTargetIsSafe(options)
    return
  } catch (error) {
    if (options?.isVercel && options.deploymentEnv === 'production' && await isCurrentProductionDeployment(options)) return
    throw error
  }
}

/** Cron handlers are callable only through the active project's Production URL. */
export function isProductionCronEnvironment({ deploymentEnv, requestHost, deploymentUrl, projectProductionUrl, activeProductionHosts } = {}) {
  return deploymentEnv === 'production' && isActiveProductionRequest({ requestHost, deploymentUrl, projectProductionUrl, activeProductionHosts })
}

/** Accept the stable Production alias or verify that this deployment ID is currently behind it. */
export async function isProductionCronRequestAllowed(options = {}) {
  if (options.deploymentEnv !== 'production') return false
  if (isActiveProductionRequest(options)) return true
  return isCurrentProductionDeployment(options)
}
