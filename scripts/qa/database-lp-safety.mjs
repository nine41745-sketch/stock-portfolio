import assert from 'node:assert/strict'

export function assertLocalDockerEndpoint(endpoint) {
  assert.equal(typeof endpoint, 'string')
  assert.ok(/^npipe:\/{4}\.\/pipe\/[A-Za-z0-9_.-]+$/.test(endpoint)
    || /^unix:\/\/\/(?!\/)[^\0\r\n]+$/.test(endpoint), 'Only an explicitly local Docker socket is allowed')
  return endpoint
}
