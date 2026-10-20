import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js'
import { Hono } from 'hono'
import { serveStatic } from 'hono/serve-static'

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))

test('every locked SDK/Hono copy meets the advisory patch floor', () => {
  for (const [name, major, minor, patch] of [
    ['@modelcontextprotocol/sdk', 1, 32, 0],
    ['hono', 4, 13, 11],
  ]) {
    const entries = Object.entries(lock.packages).filter(([path]) => path.endsWith(`node_modules/${name}`))
    assert.ok(entries.length > 0, `${name} must remain covered`)
    for (const [path, value] of entries) {
      assert.match(value.version, /^\d+\.\d+\.\d+$/, `${path}: stable version required`)
      const actual = value.version.split('.').map(Number)
      assert.equal(actual[0], major, `${path}: major upgrades need separate compatibility review`)
      assert.ok(actual[1] > minor || (actual[1] === minor && actual[2] >= patch), `${path}: vulnerable ${value.version}`)
      assert.match(value.resolved, /^https:\/\/registry\.npmjs\.org\//)
      assert.match(value.integrity, /^sha512-/)
      const installed = JSON.parse(fs.readFileSync(`${path}/package.json`, 'utf8'))
      assert.equal(installed.version, value.version, `${path}: installed version must match the lockfile`)
    }
  }
})

async function listen(t, handler) {
  const server = createServer(handler)
  server.requestTimeout = 2500
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    server.closeAllConnections()
    await closed
  })
  return `http://127.0.0.1:${server.address().port}`
}

function transport(t, origin, allowedOrigins) {
  const client = new StreamableHTTPClientTransport(new URL(`${origin}/start`), {
    sessionId: 'synthetic-session',
    requestInit: { headers: { 'x-synthetic-key': 'synthetic-value' } },
    fetch: (input, init = {}) => {
      assert.ok(allowedOrigins.includes(new URL(input).origin), 'Only test-owned loopback endpoints are allowed')
      return fetch(input, {
        ...init,
        signal: AbortSignal.any([AbortSignal.timeout(2500), ...(init.signal ? [init.signal] : [])]),
      })
    },
  })
  t.after(() => client.close())
  return client
}

const notification = { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } }

test('SDK refuses a cross-origin 307 before forwarding session headers or body', { timeout: 8000 }, async t => {
  const leaked = []
  const target = await listen(t, async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    leaked.push({ headers: req.headers, body })
    res.writeHead(202).end()
  })
  let sourcePosts = 0
  const source = await listen(t, (req, res) => {
    if (req.method !== 'POST') return res.writeHead(405).end()
    sourcePosts++
    res.writeHead(307, { location: `${target}/sink` }).end()
  })
  const client = transport(t, source, [source, target])
  await client.start()
  await assert.rejects(client.send(notification), error => {
    assert.ok(error instanceof StreamableHTTPError, 'A timeout or socket failure must not count as redirect protection')
    assert.equal(error.code, 307)
    assert.match(error.message, /Redirect .*not followed/)
    assert.match(error.message, /redirectPolicy: 'same-origin'/)
    return true
  })
  assert.equal(sourcePosts, 1, 'The real transport must reach the redirecting server')
  assert.deepEqual(leaked, [], 'No request, body, synthetic key or session may reach another origin')
})

test('SDK still follows same-origin redirects and delivers the synthetic notification', { timeout: 8000 }, async t => {
  const received = []
  const source = await listen(t, async (req, res) => {
    if (req.method !== 'POST') return res.writeHead(405).end()
    if (req.url === '/start') return res.writeHead(307, { location: '/accepted' }).end()
    let body = ''
    for await (const chunk of req) body += chunk
    received.push({ path: req.url, session: req.headers['mcp-session-id'], key: req.headers['x-synthetic-key'], body: JSON.parse(body) })
    res.writeHead(202).end()
  })
  const client = transport(t, source, [source])
  await client.start()
  await client.send(notification)
  assert.deepEqual(received, [{ path: '/accepted', session: 'synthetic-session', key: 'synthetic-value', body: notification }])
})

test('SDK task storage isolates another session while preserving owner access', async t => {
  const store = new InMemoryTaskStore()
  t.after(() => store.cleanup())
  const owned = await store.createTask({ ttl: 5000 }, 1, { jsonrpc: '2.0', id: 1, method: 'synthetic/task' }, 'owner-a')
  assert.equal((await store.getTask(owned.taskId, 'owner-a')).taskId, owned.taskId)
  assert.equal(await store.getTask(owned.taskId, 'owner-b'), null)
  assert.deepEqual((await store.listTasks(undefined, 'owner-b')).tasks, [])
  await assert.rejects(store.updateTaskStatus(owned.taskId, 'cancelled', undefined, 'owner-b'))
  assert.equal((await store.getTask(owned.taskId, 'owner-a')).status, 'working')
  await store.updateTaskStatus(owned.taskId, 'cancelled', undefined, 'owner-a')
  assert.equal((await store.getTask(owned.taskId, 'owner-a')).status, 'cancelled')
})

test('Hono rejects double-decoded static paths before reading protected content', async () => {
  const reads = []
  const app = new Hono()
  app.use('/static/admin/*', c => c.text('Synthetic access denied', 401))
  app.use('/static/*', serveStatic({
    getContent: path => {
      reads.push(path)
      return path === 'static/admin/secret.txt' ? 'synthetic-private-content' : null
    },
  }))
  assert.equal((await app.request('/static/admin/secret.txt')).status, 401)
  const response = await app.request('/static/%%36%31dmin/secret.txt')
  assert.equal(response.status, 404)
  assert.deepEqual(reads, [], 'Encoded input must not reach the content reader')
})

test('Hono continues serving ordinary encoded public paths', async () => {
  const app = new Hono()
  app.use('/static/*', serveStatic({ getContent: path => path === 'static/public file.txt' ? 'synthetic-public-content' : null }))
  const response = await app.request('/static/public%20file.txt')
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'synthetic-public-content')
})
