const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export class LocalUserAuthError extends Error {
  constructor(code, status = null) {
    super(code)
    this.name = 'LocalUserAuthError'
    this.code = code
    this.status = status
  }
}

function localAuthOrigin(baseUrl, expectedPort) {
  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new LocalUserAuthError('LOCAL_AUTH_URL_INVALID')
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    parsed.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(hostname) ||
    parsed.port !== String(expectedPort) ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new LocalUserAuthError('LOCAL_AUTH_URL_NOT_ALLOWED')
  }

  return parsed.origin
}

async function requestLocalAuth(fetchImpl, url, options, failureCode) {
  try {
    return await fetchImpl(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new LocalUserAuthError(failureCode)
  }
}

async function readJson(response, failureCode) {
  try {
    return await response.json()
  } catch {
    throw new LocalUserAuthError(failureCode, response.status)
  }
}

/**
 * Obtains and verifies a short-lived User JWT from the disposable loopback Auth API.
 * The credential and returned token are handled in memory only; errors contain no response body.
 */
export async function getVerifiedLocalUserAccessToken({
  baseUrl,
  expectedPort,
  anonKey,
  email,
  password,
  expectedUserId,
  fetchImpl = fetch,
}) {
  const origin = localAuthOrigin(baseUrl, expectedPort)
  if (
    typeof anonKey !== 'string' || !anonKey ||
    typeof email !== 'string' || !email ||
    typeof password !== 'string' || !password ||
    typeof expectedUserId !== 'string' || !expectedUserId ||
    typeof fetchImpl !== 'function'
  ) {
    throw new LocalUserAuthError('LOCAL_AUTH_INPUT_INVALID')
  }

  const tokenResponse = await requestLocalAuth(
    fetchImpl,
    `${origin}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    'LOCAL_AUTH_TOKEN_REQUEST_FAILED',
  )

  if (!tokenResponse.ok) {
    const code = [400, 401, 403].includes(tokenResponse.status)
      ? 'LOCAL_AUTH_INVALID_CREDENTIALS'
      : 'LOCAL_AUTH_TOKEN_REQUEST_FAILED'
    throw new LocalUserAuthError(code, tokenResponse.status)
  }

  const tokenPayload = await readJson(tokenResponse, 'LOCAL_AUTH_TOKEN_RESPONSE_INVALID')
  const accessToken = tokenPayload?.access_token
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new LocalUserAuthError('LOCAL_AUTH_ACCESS_TOKEN_MISSING', tokenResponse.status)
  }

  const identityResponse = await requestLocalAuth(
    fetchImpl,
    `${origin}/auth/v1/user`,
    {
      method: 'GET',
      headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
    },
    'LOCAL_AUTH_IDENTITY_REQUEST_FAILED',
  )

  if (!identityResponse.ok) {
    throw new LocalUserAuthError('LOCAL_AUTH_TOKEN_IDENTITY_REJECTED', identityResponse.status)
  }

  const identity = await readJson(identityResponse, 'LOCAL_AUTH_IDENTITY_RESPONSE_INVALID')
  if (identity?.id !== expectedUserId) {
    throw new LocalUserAuthError('LOCAL_AUTH_IDENTITY_MISMATCH', identityResponse.status)
  }

  return accessToken
}
