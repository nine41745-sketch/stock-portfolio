import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { enforceLoopbackCreate, openLoopbackProxy } from './qa/supabase-loopback-proxy.mjs'
const project = 'stock-lp-1234', network = `supabase_network_${project}`, scope = { project, network }
const make = () => ({ Labels: { 'com.supabase.cli.project': project }, HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '', HostPort: '54322' }] }, Binds: [`supabase_db_${project}:/var/lib/postgresql/data`] }, NetworkingConfig: { EndpointsConfig: { [network]: {} } } })
test('explicit loopback is added before create without altering port or volume', () => {
  const input = make(), result = enforceLoopbackCreate(input, scope)
  assert.equal(result.HostConfig.PortBindings['5432/tcp'][0].HostIp, '127.0.0.1')
  assert.equal(result.HostConfig.PortBindings['5432/tcp'][0].HostPort, '54322')
  assert.deepEqual(result.HostConfig.Binds, [`supabase_db_${project}:/var/lib/postgresql/data`])
})
test('CLI transient helper may select only the exact owned network via NetworkMode', () => {
  const value = make(); delete value.NetworkingConfig; value.HostConfig.NetworkMode = network
  assert.doesNotThrow(() => enforceLoopbackCreate(value, scope))
  value.HostConfig.NetworkMode = 'default'
  assert.throws(() => enforceLoopbackCreate(value, scope))
})
for (const [name, mutate] of [
  ['foreign project', v => { v.Labels['com.supabase.cli.project'] = 'other' }],
  ['foreign network', v => { v.NetworkingConfig.EndpointsConfig.other = {} }],
  ['host bind', v => { v.HostConfig.Binds = ['C:/private:/data'] }],
  ['privileged', v => { v.HostConfig.Privileged = true }],
  ['automatic publishing', v => { v.HostConfig.PublishAllPorts = true }],
  ['inherited mounts', v => { v.HostConfig.VolumesFrom = ['unrelated'] }],
  ['explicit wildcard', v => { v.HostConfig.PortBindings['5432/tcp'][0].HostIp = '0.0.0.0' }],
]) test(`${name} rejected before Docker create`, () => { const value = make(); mutate(value); assert.throws(() => enforceLoopbackCreate(value, scope)) })

test('HTTP transport hardens actual create JSON and assigns an owned helper name', async () => {
  const id = `stock-lp-test-${randomUUID()}`
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : `/tmp/${id}.sock`
  let received
  const daemon = http.createServer(async (req,res) => { const parts=[]; for await (const part of req) parts.push(part); received={url:req.url,body:JSON.parse(Buffer.concat(parts).toString())};res.writeHead(201,{'content-type':'application/json'});res.end('{"Id":"test"}') })
  await new Promise(resolve => daemon.listen(path,resolve))
  let proxy
  try {
    proxy=await openLoopbackProxy(process.platform === 'win32' ? `npipe:////./pipe/${id}` : `unix://${path}`, scope)
    const socketPath=process.platform === 'win32' ? `\\\\.\\pipe\\${proxy.endpoint.split('/').at(-1)}` : proxy.endpoint.slice(7)
    const send=(path,body)=>new Promise((resolve,reject)=>{const req=http.request({socketPath,path,method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end(body)})
    for(const path of ['/v1.52/containers/create','/containers/create']) {
      assert.equal(await send(path,JSON.stringify(make())),201)
      assert.equal(received.body.HostConfig.PortBindings['5432/tcp'][0].HostIp,'127.0.0.1')
      assert.match(new URL(received.url,'http://localhost').searchParams.get('name'),/^supabase_helper_.*_stock-lp-1234$/)
    }
    assert.equal(proxy.count(),2)
    const previous=received
    assert.equal(await send('/containers/create','SYNTHETIC_SENSITIVE_PARSE_INPUT'),403)
    assert.equal(received,previous,'Invalid JSON must never reach Docker')
    assert.deepEqual(proxy.rejections(),['CREATE_BOUNDARY_REJECTED'])
  } finally { if(proxy)await proxy.close(); await new Promise(resolve=>daemon.close(resolve)) }
})
