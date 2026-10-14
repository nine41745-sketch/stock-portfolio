'use strict'
const originalFetch = globalThis.fetch
const allowed = new Set(['localhost', '127.0.0.1', '::1'])
const logBlocked = () => {
  if (process.env.QA_NETWORK_GUARD_LOG)
    require('node:fs').appendFileSync(process.env.QA_NETWORK_GUARD_LOG, 'blocked\n', { mode: 0o600 })
}
function assertLocal(target, protocol) {
  if (target && typeof target === 'object' && target.socketPath) return
  let url
  try {
    if (typeof target === 'string' || target instanceof URL) url = new URL(target)
    else {
      const host = target?.hostname || target?.host || 'localhost'
      url = new URL(protocol + '//' + host + (target?.port ? ':' + target.port : ''))
    }
  } catch { throw new Error('QA network guard rejected an invalid URL') }
  if (!['http:', 'https:'].includes(url.protocol) || !allowed.has(url.hostname)) {
    logBlocked()
    throw new Error('QA network guard blocked an external network request')
  }
}
globalThis.fetch = async function (input, init) {
  assertLocal(typeof input === 'string' || input instanceof URL ? input : input.url, '')
  return originalFetch.call(this, input, init)
}
for (const name of ['http', 'https']) {
  const mod = require('node:' + name)
  for (const method of ['request', 'get']) {
    const original = mod[method]
    mod[method] = function (...args) {
      assertLocal(args[0], name + ':')
      return original.apply(this, args)
    }
  }
}