const UNSAFE_TARGET_MESSAGE = 'Supabase target is not isolated for this Vercel environment'
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

/** Cron handlers are callable only through the active project's Production URL. */
export function isProductionCronEnvironment({ deploymentEnv, requestHost, deploymentUrl, projectProductionUrl, activeProductionHosts } = {}) {
  return deploymentEnv === 'production' && isActiveProductionRequest({ requestHost, deploymentUrl, projectProductionUrl, activeProductionHosts })
}
