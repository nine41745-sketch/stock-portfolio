'use strict'

// Test-process boundary only; this is not an OS firewall or a hostile-code sandbox.
const { syncBuiltinESMExports } = require('node:module')
const attempts = []
function deny(api) {
  return function blockedNetworkOperation() {
    attempts.push(api)
    const error = new Error(`Synthetic runtime test denied network: ${api}`)
    error.code = 'ERR_TEST_NETWORK_DENIED'
    throw error
  }
}
function replace(object, key, label) {
  Object.defineProperty(object, key, {
    value: deny(label), writable: false, configurable: false,
  })
}

for (const [name, methods] of Object.entries({
  'node:http': ['request', 'get', 'createServer'],
  'node:https': ['request', 'get', 'createServer'],
  'node:http2': ['connect', 'createServer', 'createSecureServer'],
  'node:net': ['connect', 'createConnection', 'createServer'],
  'node:tls': ['connect', 'createServer'],
  'node:dgram': ['createSocket'],
  'node:child_process': ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'],
  'node:worker_threads': ['Worker'],
})) {
  const builtin = require(name)
  for (const method of methods) replace(builtin, method, `${name}.${method}`)
}
replace(require('node:net').Socket.prototype, 'connect', 'Socket.connect')
replace(require('node:net').Server.prototype, 'listen', 'Server.listen')
for (const name of ['node:dns', 'node:dns/promises']) {
  const dns = require(name)
  for (const key of Object.keys(dns)) {
    if (/^(lookup|resolve|reverse)/.test(key) && typeof dns[key] === 'function') {
      replace(dns, key, `${name}.${key}`)
    }
  }
  if (dns.Resolver) {
    for (const key of Object.getOwnPropertyNames(dns.Resolver.prototype)) {
      if (/^(resolve|reverse)/.test(key)) replace(dns.Resolver.prototype, key, `${name}.Resolver.${key}`)
    }
  }
}
replace(globalThis, 'fetch', 'fetch')
replace(globalThis, 'WebSocket', 'WebSocket')
syncBuiltinESMExports()
Object.defineProperty(globalThis, Symbol.for('stock-portfolio.test-network-deny'), {
  value: Object.freeze({ snapshot: () => [...attempts] }),
  writable: false, configurable: false,
})
