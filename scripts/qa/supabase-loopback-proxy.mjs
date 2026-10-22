import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { assertLocalDockerEndpoint } from './database-lp-safety.mjs'

// Per-run transport for the pinned local Supabase CLI, never a daemon setting.
// No request/response bodies are logged: they contain disposable credentials.
export function enforceLoopbackCreate(value, { project, network }) {
  assert.match(project, /^stock-lp-[a-f0-9-]+$/)
  assert.equal(network, `supabase_network_${project}`)
  assert.equal(value.Labels?.['com.supabase.cli.project'], project, 'Foreign project refused')
  const host = value.HostConfig ??= {}
  assert.ok(!host.Privileged && !host.CapAdd?.length && !host.Devices?.length, 'Privileged container refused')
  assert.ok(!host.PublishAllPorts, 'Automatic port publishing refused')
  assert.ok(!host.VolumesFrom?.length, 'Inherited mounts refused')
  assert.ok(!host.PidMode && !host.IpcMode && !host.UsernsMode, 'Namespace override refused')
  assert.ok(!host.NetworkMode || ['default', network].includes(host.NetworkMode), 'Foreign network refused')
  const endpoints = Object.keys(value.NetworkingConfig?.EndpointsConfig ?? {})
  assert.ok((endpoints.length === 1 && endpoints[0] === network)
    || (endpoints.length === 0 && host.NetworkMode === network), 'Foreign endpoint network refused')
  assert.ok(!host.Mounts?.length && !value.Mounts?.length, 'Unexpected mounts refused')
  for (const bind of host.Binds ?? []) {
    const [source, destination] = bind.split(':')
    assert.ok(source.startsWith('supabase_') && source.endsWith(`_${project}`) && !source.includes('/') && !source.includes('\\'), 'Host bind refused')
    assert.ok(destination?.startsWith('/'), 'Invalid volume destination')
  }
  for (const bindings of Object.values(host.PortBindings ?? {})) for (const binding of bindings ?? []) {
    assert.ok(!binding.HostIp || binding.HostIp === '127.0.0.1', 'Explicit non-loopback binding refused')
    binding.HostIp = '127.0.0.1'
  }
  return value
}

export async function openLoopbackProxy(endpoint, scope) {
  assertLocalDockerEndpoint(endpoint)
  const socketPath = endpoint.startsWith('npipe:') ? `\\\\.\\pipe\\${endpoint.split('/').at(-1)}` : endpoint.slice(7)
  const pipeName = `stock-lp-${randomUUID()}`
  const listenPath = process.platform === 'win32' ? `\\\\.\\pipe\\${pipeName}` : `/tmp/${pipeName}.sock`
  const sockets = new Set()
  let hardenedCreates = 0
  const rejections = []
  const proposals = []
  const server = http.createServer(async (req, res) => {
    try {
      let body
      if (req.method === 'POST' && /^(?:\/v[0-9.]+)?\/containers\/create(?:\?|$)/.test(req.url)) {
        const chunks = []; let length = 0
        for await (const chunk of req) { length += chunk.length; assert.ok(length < 4 * 1024 * 1024); chunks.push(chunk) }
        const original = JSON.parse(Buffer.concat(chunks).toString())
        proposals.push({ networkMode: original.HostConfig?.NetworkMode, endpoints: Object.keys(original.NetworkingConfig?.EndpointsConfig ?? {}), name: new URL(req.url, 'http://localhost').searchParams.get('name') })
        const parsed = enforceLoopbackCreate(original, scope)
        const url = new URL(req.url, 'http://localhost')
        let name = url.searchParams.get('name')
        // CLI schema setup uses an unnamed, project-labelled transient helper.
        // Give it an owned name so interruption cleanup can verify its identity.
        if (!name) { name = `supabase_helper_${randomUUID()}_${scope.project}`; url.searchParams.set('name', name); req.url = url.pathname + url.search }
        assert.ok(name.startsWith('supabase_') && name.endsWith(`_${scope.project}`), 'Foreign container name refused')
        body = Buffer.from(JSON.stringify(parsed)); hardenedCreates++
      }
      const headers = { ...req.headers }
      if (body) { delete headers['transfer-encoding']; headers['content-length'] = body.length }
      const upstream = http.request({ socketPath, path: req.url, method: req.method, headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res)
      })
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
      req.on('aborted', () => upstream.destroy())
      if (body) upstream.end(body); else req.pipe(upstream)
    } catch { rejections.push('CREATE_BOUNDARY_REJECTED'); res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"message":"Local QA container boundary rejected"}') }
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.on('upgrade', (req, client, head) => {
    if (!/^\/v[0-9.]+\/(?:containers\/[a-f0-9]{64}\/attach|exec\/[a-f0-9]{64}\/start)(?:\?|$)/.test(req.url)) { client.destroy(); return }
    const upstream = net.connect(socketPath)
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream))
    upstream.on('connect', () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
      if (head.length) upstream.write(head)
      client.pipe(upstream).pipe(client)
    })
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy())
    client.on('close', () => upstream.destroy())
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(listenPath, resolve) })
  return {
    endpoint: process.platform === 'win32' ? `npipe:////./pipe/${pipeName}` : `unix://${listenPath}`,
    count: () => hardenedCreates,
    rejections: () => [...rejections],
    proposals: () => [...proposals],
    close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve) }),
  }
}
