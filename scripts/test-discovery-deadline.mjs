import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { createRequire } from 'node:module'
import test from 'node:test'
const require = createRequire(import.meta.url)
let sdkCalls = 0
function load(file, cache = new Map(), overrides = {}) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file).exports
  const loadedModule = { exports: {} }; cache.set(file, loadedModule)
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const localRequire = name => {
    if (name in overrides) return overrides[name]
    if (name === 'yahoo-finance2') return class { chart() { sdkCalls++; return Promise.resolve({quotes:[]}) } }
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', cache, overrides)
    return require(name)
  }
  new Function('require','module','exports',source)(localRequire,loadedModule,loadedModule.exports)
  return loadedModule.exports
}
const indicators = load('lib/indicators.ts')
const ath = load('lib/all-time-high.ts')
const finnhub = load('lib/finnhub.ts')
function transport(mode, requireSignal = true) {
  let active=0, calls=0, aborted=0
  const requests=[]
  globalThis.fetch = async (input, init={}) => {
    const url = new URL(input); calls++; requests.push(url.href)
    if (requireSignal) assert(init.signal instanceof AbortSignal, 'Discovery transport must pass supported AbortSignal')
    init.signal?.throwIfAborted()
    if (mode === 'hang' || mode === 'body') {
      active++
      const waiting = new Promise((resolve,reject) => {
        const end = () => { active--; aborted++; clearTimeout(safety); reject(init.signal.reason) }
        const safety = setTimeout(()=>{init.signal.removeEventListener('abort',end); active--; resolve('{}')},180)
        init.signal.addEventListener('abort',end,{once:true})
      })
      if(mode === 'hang') { await waiting; return Response.json({}) }
      return {ok:true,status:200,json:()=>waiting.then(JSON.parse),text:()=>waiting}
    }
    if (mode === 'rate') return new Response('{}',{status:429})
    if (url.hostname === 'stooq.com') {
      return new Response('Date,Open,High,Low,Close,Volume\n'+Array.from({length:260},(_,i)=>`2026-01-01,${100+i},${102+i},${99+i},${101+i},1000`).join('\n'))
    }
    if(url.hostname === 'finnhub.io') return Response.json({earningsCalendar:[]})
    if (mode === 'fallback') return new Response('{}',{status:503})
    const n=url.searchParams.get('interval')==='1wk'?104:260
    return Response.json({chart:{error:null,result:[{timestamp:Array.from({length:n},(_,i)=>1700000000+i*86400),indicators:{quote:[{close:Array.from({length:n},(_,i)=>100+i),high:Array.from({length:n},(_,i)=>101+i),low:Array.from({length:n},(_,i)=>99+i),volume:Array(n).fill(1000)}]}}]}})
  }
  return {get active(){return active},get calls(){return calls},get aborted(){return aborted},requests}
}
function context(milliseconds=35) {
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(new DOMException('Budget expired','TimeoutError')),milliseconds)
  return {signal:controller.signal,canStart:()=>!controller.signal.aborted,run:async operation=>{controller.signal.throwIfAborted();return operation(controller.signal)},close:()=>{clearTimeout(timer);controller.abort()}}
}
for(const mode of ['hang','body']) test(`Discovery cancels ${mode} reads and drains all provider work`, async()=>{
  const tx=transport(mode), scope=context(); sdkCalls=0
  const start=performance.now()
  await Promise.allSettled([indicators.getTechnicalIndicators('HANG',scope),ath.getAllTimeHigh('HANG'+mode,scope),finnhub.getUpcomingEarnings('HANG',scope)])
  scope.close()
  assert.equal(sdkCalls,0,'Discovery must own cancellation rather than join shared SDK session/queue')
  assert.equal(tx.active,0,'No provider body/request remains outstanding after completion')
  assert(tx.aborted>=3,'All provider adapters must observe abort')
  assert(performance.now()-start<150,'Abort must stop actual work before synthetic safety timeout')
})
test('Yahoo HTTP failure falls back to real Stooq data with provenance',async()=>{
 const tx=transport('fallback'),scope=context(1000)
 const result=await indicators.getTechnicalIndicators('FALLBACK',scope);scope.close()
 assert.equal(result.dataSource,'Stooq');assert(result.lastClose>0);assert(tx.requests.some(url=>url.includes('stooq.com')))
})
test('429 stays unavailable without retries or fabricated scores/data',async()=>{
 const tx=transport('rate'),scope=context(1000)
 const result=await indicators.getTechnicalIndicators('RATE',scope);scope.close()
 assert.equal(result.dataSource,'unavailable');assert.equal(result.lastClose,null);assert.equal(tx.calls,4)
})
test('Expired context launches no new primary or fallback request',async()=>{
 const tx=transport('normal'),scope=context(1);await new Promise(resolve=>setTimeout(resolve,5))
 await Promise.allSettled([indicators.getTechnicalIndicators('EXPIRED',scope),ath.getAllTimeHigh('EXPIRED',scope),finnhub.getUpcomingEarnings('EXPIRED',scope)]);scope.close()
 assert.equal(tx.calls,0)
})
test('Existing callers retain SDK signatures and behavior',async()=>{
 transport('normal',false);sdkCalls=0
 await Promise.all([indicators.getTechnicalIndicators('LEGACY'),ath.getAllTimeHigh('LEGACY')])
 assert.equal(sdkCalls,3,'Legacy daily, weekly and ATH keep yahoo-finance2')
})


const { DiscoveryDeadline, DISCOVERY_WORK_BUDGET_MS } = load('lib/discovery-deadline.ts')
test('Absolute budget bounds all waves, cancels parent and drains owned work',async()=>{
 assert.equal(DISCOVERY_WORK_BUDGET_MS,40000)
 const parent=new AbortController(),scope=new DiscoveryDeadline(parent.signal,300,30)
 let active=0,aborts=0
 await assert.rejects(scope.run(signal=>new Promise((resolve,reject)=>{active++;signal.addEventListener('abort',()=>{active--;aborts++;reject(signal.reason)},{once:true})})),/provider timeout/)
 assert.equal(active,0);assert.equal(aborts,1)
 parent.abort();assert.equal(scope.canStart(),false)
 await assert.rejects(scope.run(async()=>assert.fail('must never start')))
 await scope.close();assert.equal(active,0)
})
function routeLoader(technical, deadlineClass) {
 const source=ts.transpileModule(fs.readFileSync('app/api/discovery/route.ts','utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const query={select(){return this},eq(){return this},gt(){return this},in(){return Promise.resolve({data:[],error:null})}}
 const db={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from:()=>query}
 class PhaseAError extends Error {}
 const mocks={
  'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
  '@/lib/supabase/server':{createClient:async()=>db},
  '@/lib/phase-a-context':{PhaseAError,requirePhaseAPortfolio:async()=>({userId:'owner',portfolioId:'portfolio',supabase:db}),phaseAErrorResponse:()=>Response.json({error:'gate'},{status:403})},
  '@/lib/indicators':{getTechnicalIndicators:technical},
  '@/lib/finnhub':{getUpcomingEarnings:async()=>null},
  '@/lib/all-time-high':{getAllTimeHigh:async()=>({allTimeHigh:null})},
  '@/lib/stock-scanner':load('lib/stock-scanner.ts'),
  '@/lib/discovery-contract':load('lib/discovery-contract.ts'),
  '@/lib/discovery-deadline':{DiscoveryDeadline:deadlineClass},
 }
 const loadedModule={exports:{}}
 new Function('require','module','exports',source)(name=>{assert(name in mocks,`Unexpected route dependency ${name}`);return mocks[name]},loadedModule,loadedModule.exports)
 return loadedModule.exports.GET
}
const completeTechnical={dataSource:'Yahoo Finance',lastBarAt:new Date().toISOString(),lastClose:100,rsi14:60,scannerVolumeRatio:1.5,return20dPct:5,return60dPct:8,trend:'UPTREND',weeklyRsi14:60,macd:{histogram:1},ema50:90,scannerSupport:85,scannerResistance:105,week52High:110,week52Low:70}
test('Actual route preserves ordered partial results and cap 12/concurrency 2 at deadline',async()=>{
 let active=0,maxActive=0,started=0,closed=false
 class ShortDeadline extends DiscoveryDeadline {constructor(signal){super(signal,440,100)}async close(){await super.close();closed=true}}
 const technical=async(symbol,scope)=>{
  assert(scope,'Actual route must pass request scope to every adapter')
  if(symbol==='SPY')return completeTechnical
  started++;active++;maxActive=Math.max(maxActive,active)
  try{await new Promise(resolve=>setTimeout(resolve,105));return completeTechnical}finally{active--}
 }
 const route=routeLoader(technical,ShortDeadline)
 const response=await route({nextUrl:new URL('https://local/api/discovery?view=radar'),signal:new AbortController().signal})
 const data=await response.json()
 assert.equal(response.status,200);assert.equal(data.items.length,12);assert.equal(maxActive,2)
 assert(started>0&&started<12,'deadline must stop subsequent batches')
 assert.equal(data.items.filter(row=>row.status==='available').length,started)
 assert(data.items.filter(row=>row.status==='unavailable').every(row=>row.score===null))
 assert.deepEqual(data.items.map(row=>row.symbol),data.symbols)
 assert.equal(active,0);assert(closed,'route must close/drain deadline before returning')
})
test('Failed benchmark skips wasteful symbol fan-out and returns truthful unavailable rows',async()=>{
 let calls=0
 const route=routeLoader(async()=>{calls++;return {return20dPct:null,return60dPct:null}},DiscoveryDeadline)
 const response=await route({nextUrl:new URL('https://local/api/discovery?view=radar'),signal:new AbortController().signal})
 const data=await response.json()
 assert.equal(calls,1,'No symbol can be scored without SPY; stop new provider work')
 assert.equal(data.items.length,12);assert(data.items.every(row=>row.status==='unavailable'&&row.score===null))
})

test('Budgeted Auth/REST transport aborts stalled body and never exposes a live stream to SDK',async()=>{
 const {createDeadlineFetch}=load('lib/discovery-deadline.ts')
 assert.equal(typeof createDeadlineFetch,'function','Auth/REST need the same owned transport deadline')
 const scope=new DiscoveryDeadline(undefined,300,25)
 let active=0
 const original=globalThis.fetch
 globalThis.fetch=async(input,init)=>{
  active++
  const body=new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>{active--;controller.error(init.signal.reason)},{once:true})}})
  return new Response(body,{headers:{'content-type':'application/json'}})
 }
 try{await assert.rejects(createDeadlineFetch(scope)('http://127.0.0.1/auth/v1/user'));await scope.close();assert.equal(active,0)}finally{globalThis.fetch=original}
})
test('Budgeted Auth/REST preserves response status, headers and consumed data',async()=>{
 const {createDeadlineFetch}=load('lib/discovery-deadline.ts')
 assert.equal(typeof createDeadlineFetch,'function')
 const scope=new DiscoveryDeadline(undefined,300,25),original=globalThis.fetch
 let ownedBody
 globalThis.fetch=async(input,init)=>{assert(init.signal instanceof AbortSignal);ownedBody=Response.json({id:'synthetic-user'},{status:200,headers:{'x-test':'preserved'}});return ownedBody}
 try{const result=await createDeadlineFetch(scope)('http://127.0.0.1/auth/v1/user');assert(ownedBody.bodyUsed);assert.equal(result.status,200);assert.equal(result.headers.get('x-test'),'preserved');assert.deepEqual(await result.json(),{id:'synthetic-user'});await scope.close()}finally{globalThis.fetch=original}
})

for (const stage of ['auth','auth-invalid','portfolio']) test(`Actual Supabase SDK ${stage} status mapping stays fail-closed and drains`,async()=>{
 const original=globalThis.fetch
 const savedUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,savedKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-local-key'
 const jwt=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:'synthetic-owner',exp:Math.floor(Date.now()/1000)+3600,session_id:'synthetic-session'})).toString('base64url')+'.synthetic'
 const session={access_token:jwt,refresh_token:'synthetic-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:{id:'synthetic-owner'}}
 const jar=[{name:'sb-127-auth-token',value:'base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')}]
 const cookieStore={getAll:()=>jar,get:name=>jar.find(row=>row.name===name),set(){}}
 let active=0,authCalls=0,restCalls=0,pinChecks=0
 const cache=new Map(),overrides={
  'next/headers':{cookies:async()=>cookieStore},
  '@/lib/pin-session':{PIN_SESSION_COOKIE_NAME:'pin-session',getSupabaseSessionId:()=> 'synthetic-session',verifyPinSessionValue:async()=>{pinChecks++;return true}},
  '@/lib/portfolio-context':{ACTIVE_PORTFOLIO_COOKIE:'active-portfolio'},
 }
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input);assert.equal(url.hostname,'127.0.0.1','Only synthetic local transport is allowed')
  assert(init.signal instanceof AbortSignal)
  if(url.pathname.includes('/auth/'))authCalls++;else restCalls++
  if((stage==='auth'&&url.pathname.includes('/auth/'))||(stage==='portfolio'&&url.pathname.includes('/rest/'))){
   active++
   await new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{active--;reject(init.signal.reason)},{once:true}))
  }
  if(url.pathname.includes('/auth/'))return stage==='auth-invalid'?Response.json({code:'invalid_jwt',msg:'synthetic invalid session'},{status:401}):Response.json({id:'synthetic-owner'})
  return Response.json([{id:'synthetic-portfolio',name:'Synthetic',is_default:true}])
 }
 const startedAt=performance.now();const scope=new DiscoveryDeadline(undefined,1000,30)
 try{
  const server=load('lib/supabase/server.ts',cache,overrides)
  const helper=load('lib/phase-a-context.ts',cache,overrides)
  const client=await server.createClient(scope)
  let mappedStatus
  await assert.rejects(helper.requirePhaseAPortfolio(undefined,client),error=>{
   assert(error instanceof helper.PhaseAError)
   const response=helper.phaseAErrorResponse(error)
   mappedStatus=response.status
   return error.status===(stage==='auth-invalid'?401:503)
  })
  assert.equal(mappedStatus,stage==='auth-invalid'?401:503,'The Discovery route delegates PhaseAError HTTP status mapping to this response helper')
  await scope.close()
  assert(performance.now()-startedAt<1000,'SDK retry sleeps must not outlive absolute budget');assert.equal(active,0);assert.equal(authCalls,1);assert.equal(pinChecks,stage==='portfolio'?1:0);assert.equal(restCalls,stage==='portfolio'?1:0)
 }finally{await scope.close();globalThis.fetch=original;if(savedUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=savedUrl;if(savedKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=savedKey}
})

const yahooChart = load('lib/discovery-yahoo.ts')
test('Direct Yahoo chart parsing accepts finite chart data with dates and provenance-ready bars', async()=>{
 const tx=transport('normal'),scope=context(1000)
 try{
  const result=await yahooChart.getDiscoveryYahooChart('SYNTH/TEST',0,'1mo',scope)
  assert.equal(result.quotes.length,260)
  assert.equal(result.quotes[0].high,101)
  assert(result.quotes[0].date instanceof Date)
  assert(tx.requests[0].includes('SYNTH%2FTEST'))
 }finally{scope.close()}
})
for(const payload of [null,{chart:{error:{code:'Not Found'},result:null}},{chart:{error:null,result:[{timestamp:'invalid',indicators:{quote:[{}]}}]}}]){
 test(`Malformed or invalid Yahoo chart response fails closed: ${payload===null?'empty':payload.chart?.error?'provider-error':'invalid-shape'}`,async()=>{
  const original=globalThis.fetch,scope=context(1000)
  globalThis.fetch=async(input,init)=>{assert(init.signal instanceof AbortSignal);return Response.json(payload)}
  try{await assert.rejects(yahooChart.getDiscoveryYahooChart('SYNTH',0,'1mo',scope))}finally{scope.close();globalThis.fetch=original}
 })
}
for(const status of [401,429]) test(`Yahoo HTTP ${status} cancels an unread error body`,async()=>{
 const original=globalThis.fetch,scope=context(1000);let cancelled=0
 globalThis.fetch=async(input,init)=>{
  assert(init.signal instanceof AbortSignal)
  return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3]))},cancel(){cancelled++}}),{status})
 }
 try{await assert.rejects(yahooChart.getDiscoveryYahooChart('SYNTH',0,'1mo',scope));assert.equal(cancelled,1)}finally{scope.close();globalThis.fetch=original}
})
for(const status of [401,429]) test(`Yahoo HTTP ${status} falls back to synthetic Stooq bars without external access`,async()=>{
 const original=globalThis.fetch,scope=context(1000),hosts=[]
 globalThis.fetch=async(input,init)=>{
  assert(init.signal instanceof AbortSignal)
  const url=new URL(input);hosts.push(url.hostname)
  if(url.hostname==='query2.finance.yahoo.com')return new Response('{}',{status})
  assert.equal(url.hostname,'stooq.com')
  return new Response('Date,Open,High,Low,Close,Volume\n'+Array.from({length:260},(_,i)=>`2026-01-01,${100+i},${102+i},${99+i},${101+i},1000`).join('\n'))
 }
 try{const result=await indicators.getTechnicalIndicators(`HTTP${status}FALLBACK`,scope);assert.equal(result.dataSource,'Stooq');assert(result.lastClose>0);assert(hosts.includes('stooq.com'))}finally{scope.close();globalThis.fetch=original}
})
test('Discovery ATH cache removes repeat per-symbol Yahoo requests without changing values',async()=>{
 const original=globalThis.fetch,scopeA=context(1000),scopeB=context(1000);let calls=0
 const symbols=Array.from({length:12},(_,i)=>`SYNTH-ATH-CACHE-${i}-20261016`)
 globalThis.fetch=async(input,init)=>{calls++;assert(init.signal instanceof AbortSignal);return Response.json({chart:{error:null,result:[{timestamp:[1700000000],indicators:{quote:[{high:[123.45],close:[120],low:[119],volume:[500]}]}}]}})}
 try{
  const first=await Promise.all(symbols.map(symbol=>ath.getAllTimeHigh(symbol,scopeA)))
  assert.equal(calls,12,'A cold 12-symbol scan makes one monthly ATH request per symbol')
  const second=await Promise.all(symbols.map(symbol=>ath.getAllTimeHigh(symbol,scopeB)))
  assert.deepEqual(second,first);assert.equal(calls,12,'A warm repeat scan makes no additional monthly ATH requests')
  const retrySymbol='SYNTH-ATH-FAILED-NOT-CACHED-20261016';let attempts=0
  globalThis.fetch=async(input,init)=>{attempts++;assert(init.signal instanceof AbortSignal);return attempts===1?new Response('{}',{status:503}):Response.json({chart:{error:null,result:[{timestamp:[1700000000],indicators:{quote:[{high:[123.45]}]}}]}})}
  const failed=await ath.getAllTimeHigh(retrySymbol,scopeA)
  const recovered=await ath.getAllTimeHigh(retrySymbol,scopeB)
  assert.equal(failed.allTimeHigh,null);assert.equal(recovered.allTimeHigh,123.45);assert.equal(attempts,2,'Transient provider failure must not poison the six-hour cache')
 }finally{scopeA.close();scopeB.close();globalThis.fetch=original}
})
test('Deadline signal abort cannot settle a provider that ignores it; ownership waits for settlement',async()=>{
 const scope=new DiscoveryDeadline(undefined,500,25);let release,started,aborted=false,settled=false
 const didStart=new Promise(resolve=>{started=resolve})
 const task=scope.run(signal=>new Promise(resolve=>{release=resolve;started();signal.addEventListener('abort',()=>{aborted=true},{once:true})})).then(()=>{settled=true})
 const observed=task.catch(error=>{settled=true;return error})
 await didStart;await new Promise(resolve=>setTimeout(resolve,25))
 assert(aborted);assert.equal(settled,false,'No race may return while an uncooperative provider remains outstanding')
 release();const outcome=await observed;assert.equal(outcome,undefined);await scope.close();assert.equal(settled,true)
})
