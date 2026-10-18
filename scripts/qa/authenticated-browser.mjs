import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { assertNoUnexpectedHttpFailures, isExpectedHttpFailure, readHttpFailureEvidence, unexpectedConsoleHttpErrors } from './expected-http-failures.mjs'
import { markQaStageSync, recordQaCheckSync, recordInterruptedRunSync } from './qa-runner-evidence.mjs'
import { getVerifiedLocalUserAccessToken } from './local-user-auth-token.mjs'
import { createHttpEvidenceLifecycle } from './http-response-evidence.mjs'
const base = new URL(process.env.QA_BASE_URL ?? '')
const local = h => ['localhost', '127.0.0.1', '::1'].includes(h)
const sb = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
assert(local(base.hostname) && base.protocol === 'http:' && base.port === process.env.QA_APP_PORT)
assert(local(sb.hostname) && sb.protocol === 'http:' && sb.port === process.env.QA_SUPABASE_API_PORT)
assert(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY)
assert(!process.env.FINNHUB_API_KEY && !process.env.SEC_USER_AGENT && !process.env.GROQ_API_KEY)
const dir = process.env.QA_ARTIFACT_DIR ?? '.local-artifacts/authenticated-browser-qa'
await mkdir(dir,{recursive:true})
const checks=[]
const themeMatrix=[]
const browserConsoleErrors=[]
const browserHttpFailures=[]
const browserRuntimeErrors=[]
const httpEvidence=createHttpEvidenceLifecycle()
let browser=null
let context=null
let qaStage='RUNNER_STARTING'
markQaStageSync(dir,qaStage)
const setStage=stage=>{qaStage=stage;markQaStageSync(dir,stage)}
let authReady=false, pinReady=false
let lifecycleSequence=0
let activeAuthAttempt=null
const portfolioLifecycle={accounts:[]}
const lifecycleEvidence={authAttempts:[],controls:[],portfolioInitializations:portfolioLifecycle.accounts}
let activeAccount='A'
const requestContexts=new WeakMap()
const pass=name=>{
 checks.push({name,status:'PASS'})
 recordQaCheckSync(dir,qaStage,name)
 console.log(`QA_CHECK ${JSON.stringify({stage:qaStage,status:'PASS',name})}`)
}
const browserDeadlineMs=Number(process.env.QA_BROWSER_DEADLINE_MS??0)
assert(Number.isInteger(browserDeadlineMs)&&browserDeadlineMs>=60_000,'A bounded browser runner deadline is required')
let runnerTerminated=false
const forceExitTimer={current:null}
process.once('SIGTERM',()=>{
 if(runnerTerminated)return
 runnerTerminated=true
 recordInterruptedRunSync(dir,'timeout')
 forceExitTimer.current=setTimeout(()=>process.exit(124),5_000)
 Promise.allSettled([context?.close(),browser?.close()]).finally(()=>{
  if(forceExitTimer.current)clearTimeout(forceExitTimer.current)
  process.exit(124)
 })
})
const deadlineTimer=setTimeout(()=>process.kill(process.pid,'SIGTERM'),browserDeadlineMs)
const requestGet=(request,url,options={})=>request.get(url,{timeout:15_000,...options})
const requestPost=(request,url,options={})=>request.post(url,{timeout:15_000,...options})
const requestPatch=(request,url,options={})=>request.patch(url,{timeout:15_000,...options})
const requestDelete=(request,url,options={})=>request.delete(url,{timeout:15_000,...options})
const localFetchOptions=options=>({...options,signal:AbortSignal.timeout(10_000)})
const nextLifecycleSequence=()=>++lifecycleSequence
function recordLifecycleControl(control){
 const entry={...control,sequence:nextLifecycleSequence()}
 lifecycleEvidence.controls.push(entry)
 return entry
}
function beginAuthAttempt(account,unauthenticatedControlSequence){
 const attempt={
  id:`${account}-${lifecycleEvidence.authAttempts.length+1}`,
  account,
  phase:'login-form',
  startedSequence:nextLifecycleSequence(),
  unauthenticatedControlSequence,
  authenticatedControlSequence:null,
  authenticatedHasPin:null,
  pinSetupControlSequence:null,
  pinSetupHasPin:null,
  pinSubmissionSequence:null,
  initialPinReadyControlSequence:null,
  pinReadyControlSequence:null,
  pinLockTransitions:[],
 }
 lifecycleEvidence.authAttempts.push(attempt)
 activeAuthAttempt=attempt
 return attempt
}
function recordAuthStatusControl(attempt,response,payload){
 const control=recordLifecycleControl({kind:'auth-positive-control',account:attempt.account,status:response.status(),hasPin:payload.hasPin===true})
 attempt.authenticatedControlSequence=control.sequence
 attempt.authenticatedHasPin=payload.hasPin===true
 if(payload.hasPin===false){
  attempt.pinSetupControlSequence=control.sequence
  attempt.pinSetupHasPin=false
 }
 return control
}
function recordPinReadyControl(attempt,response,transition=null){
 assert.equal(response.status(),200,'Protected API must confirm Auth and PIN readiness')
 const control=recordLifecycleControl({kind:'protected-api-positive-control',account:attempt.account,status:response.status()})
 attempt.initialPinReadyControlSequence??=control.sequence
 attempt.pinReadyControlSequence=control.sequence
 if(transition)transition.unlockedControlSequence=control.sequence
 return control
}
async function syntheticPortfolioCount(userId){
 const response=await fetch(new URL(`/rest/v1/portfolios?select=id,is_default&user_id=eq.${encodeURIComponent(userId)}`,sb),localFetchOptions({
  headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY},
 }))
 assert.equal(response.status,200,'Disposable Supabase Admin must verify the synthetic portfolio count')
 return response.json()
}
async function readNetworkGuardAttempts(){
 try{return (await readFile(process.env.QA_NETWORK_GUARD_LOG,'utf8')).split('\n').filter(Boolean).length}
 catch{return 0}
}
function startPortfolioInitialization(account){
 const initialization={account,state:'empty',emptyDatabaseCount:0,emptyDatabaseControlSequence:null,emptyControls:[],creationStartedSequence:null,createdControlSequence:null}
 portfolioLifecycle.accounts.push(initialization)
 return initialization
}
function recordPortfolioRequiredControl(initialization,path,response,payload,requestSequence){
 assert.equal(response.status(),409,`${path} must explicitly require a portfolio for a new account`)
 assert.equal(payload.code,'PORTFOLIO_REQUIRED',`${path} must distinguish an empty portfolio from another failure`)
 assert.match(response.headers()['cache-control']??'',/no-store/,`${path} must not cache an empty portfolio response`)
 assert(Number.isInteger(requestSequence),'Empty-portfolio failure must be tied to its observed request lifecycle')
 const control=recordLifecycleControl({kind:'empty-portfolio-negative-control',account:initialization.account,path,status:409,code:'PORTFOLIO_REQUIRED',requestSequence})
 initialization.emptyControls.push({path,requestSequence,controlSequence:control.sequence})
}
function recordFirstPortfolioCreated(initialization,response,rows){
 assert.equal(response.status(),200,'Authenticated POST must explicitly create the first portfolio')
 assert.equal(rows.length,1,'Explicit first creation must produce exactly one portfolio')
 assert.equal(rows.filter(row=>row.is_default).length,1,'Exactly one synthetic default portfolio must exist after creation')
 const control=recordLifecycleControl({kind:'first-portfolio-created-control',account:initialization.account,status:200,portfolioCount:rows.length,defaultCount:rows.filter(row=>row.is_default).length})
 initialization.createdControlSequence=control.sequence
 initialization.state='created'
}
async function recordUnauthenticatedControl(response,account){
 assert.equal(response.status(),401,`${account} logged-out control must be rejected`)
 const payload=await response.json()
 assert.equal(payload.error,'Unauthorized',`${account} logged-out control must prove missing Auth, not a PIN gate`)
 return recordLifecycleControl({kind:'unauthenticated-negative-control',account,status:response.status(),authGate:'unauthorized'})
}
const email='qa-'+randomUUID()+'@example.test'
const password=randomBytes(24).toString('base64url')
const pin='583104'
setStage('AUTH_SETUP')
const created=await fetch(new URL('/auth/v1/admin/users',sb),{
  ...localFetchOptions({method:'POST'}),
  headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},
  body:JSON.stringify({email,password,email_confirm:true}),
})
assert.equal(created.status,200)
const qaUser=await created.json()
pass('Synthetic user created by local Auth Admin')
let outside=0, mode='synthetic', watchlistMode='normal', scannerMode='mock', riskMode='synthetic', secRiskMode='synthetic'
setStage('BROWSER_STARTING')
browser=await chromium.launch({headless:true})
try {
 context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
 context.setDefaultTimeout(15_000)
 context.setDefaultNavigationTimeout(30_000)
 setStage('BROWSER_READY')
 const page=await context.newPage()
 const navigate=url=>httpEvidence.beforeNavigation(()=>page.goto(url))
 page.on('console',message=>{
  if(message.type()==='error'){
   const status=message.text().match(/status of (\d{3})/)
   let path
   try { path=new URL(message.location().url).pathname } catch {}
   browserConsoleErrors.push(status?{kind:'http-status',status:Number(status[1]),path}:{kind:'console-error'})
  }
 })
 page.on('pageerror',()=>browserRuntimeErrors.push('page-error'))
 page.on('request',request=>{
  requestContexts.set(request,{
   sequence:nextLifecycleSequence(),
  stage:qaStage,
  authReady,
  pinReady,
   authAttemptId:activeAuthAttempt?.id??null,
   authPhase:activeAuthAttempt?.phase??'none',
   method:request.method(),
   account:activeAccount,
   portfolioState:portfolioLifecycle.accounts.find(item=>item.account===activeAccount)?.state??'unknown',
  fixtureMode:request.url().includes('/api/risk')?riskMode:
    request.url().includes('/api/sec-risk')?secRiskMode:
    request.url().includes('/api/fundamentals')?mode:
    request.url().includes('/api/watchlist')?watchlistMode:undefined,
  })
  if(new URL(request.url()).pathname.startsWith('/api/'))httpEvidence.requestStarted(request)
 })
 page.on('requestfinished',request=>httpEvidence.requestFinished(request))
 page.on('requestfailed',request=>httpEvidence.requestFailed(request))
 page.on('response',response=>{
  if(response.status()>=400){
   const task=(async()=>{
    const requestContext=requestContexts.get(response.request())??{stage:'unknown',authReady:false,pinReady:false}
    const responseSequence=nextLifecycleSequence()
    const evidence=await readHttpFailureEvidence(response)
    const failure={
     path:new URL(response.url()).pathname,
     status:response.status(),
     ...requestContext,
     requestSequence:requestContext.sequence??null,
     responseSequence,
     authGate:evidence.authGate??'unclassified',
     responseBodyStatus:evidence.responseBodyStatus,
     ...(evidence.responseReadFailure?{responseReadFailure:evidence.responseReadFailure}:{}),
     ...(evidence.failureCode?{failureCode:evidence.failureCode}:{}),
    }
    browserHttpFailures.push(failure)
   })()
   httpEvidence.trackResponse(task)
  }
 })
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url())
  if(!local(u.hostname)||(u.port!==process.env.QA_APP_PORT&&u.origin!==process.env.NEXT_PUBLIC_SUPABASE_URL)){outside++;await route.abort('blockedbyclient');return}
  if(u.pathname==='/api/fundamentals'){
   if(mode==='loading') await new Promise(resolve=>setTimeout(resolve,1000))
   if(mode==='error') await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic provider error'})})
   else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture())})
   return
  }
  if(u.pathname==='/api/risk'){
   if(riskMode==='loading') await new Promise(resolve=>setTimeout(resolve,400))
   if(riskMode==='error') return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic risk unavailable'})})
   const riskData=riskFixture()
   if(riskMode==='empty'){riskData.positions=[];riskData.sectors=[]}
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(riskData)})
  }
  if(u.pathname==='/api/sec-risk'){
   if(secRiskMode==='error') return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic SEC risk unavailable'})})
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(secRiskFixture())})
  }
  if(u.pathname==='/api/scanner'&&scannerMode!=='real-mine') return route.fulfill({status:200,contentType:'application/json',body:'{"items":[]}'})
  if(u.pathname==='/api/watchlist'&&watchlistMode==='missing-schema') return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic missing portfolio Watchlist migration',migration_required:true})})
  return route.continue()
 })
 setStage('anonymous')
 const anonymous=await context.newPage()
 await anonymous.goto(new URL('/scanner',base).href)
 await anonymous.waitForURL(/\/login(?:\?|$)/)
  const anonymousAuthControl=await recordUnauthenticatedControl(
   await requestGet(anonymous.request,new URL('/api/pin/status',base).href),'A'
  )
 pass('Anonymous page and API are rejected')
  const authAttemptA=beginAuthAttempt('A',anonymousAuthControl.sequence)
 setStage('login')
 await navigate(new URL('/login',base).href)
 await page.addStyleTag({content:'nextjs-portal{display:none!important}'})
 await page.locator('input[type="email"]').fill(email)
 await page.locator('input[type="password"]').fill(password)
  authAttemptA.phase='authenticating'
  authAttemptA.authRequestSequence=nextLifecycleSequence()
 await page.getByRole('button',{name:'เข้าสู่ระบบ'}).click()
 await page.waitForURL(/\/(?:pin|dashboard)(?:\?|$)/)
  setStage('pin-setup')
 if(new URL(page.url()).pathname!=='/pin') await navigate(new URL('/pin',base).href)
 const pinStatus=await requestGet(page.request,new URL('/api/pin/status',base).href)
 assert.equal(pinStatus.status(),200,'Supabase Auth must be ready before initial PIN setup')
  const initialPinStatus=await pinStatus.json()
  assert.equal(initialPinStatus.hasPin,false,'New synthetic account must not already have a PIN')
  recordAuthStatusControl(authAttemptA,pinStatus,initialPinStatus)
  authAttemptA.phase='pin-setup'
 authReady=true
 await page.getByText('ตั้ง PIN 6 หลัก').waitFor()
 const locked=await requestGet(page.request,new URL('/api/fundamentals?symbols=AAPL',base).href)
 assert.equal(locked.status(),401)
 assert.match((await locked.json()).error,/PIN/i)
 const legacyLocked=await requestGet(page.request,new URL('/api/watchlist/legacy',base).href)
 assert.equal(legacyLocked.status(),401,'Legacy Watchlist must enforce PIN before reading')
 pass('Authenticated session is denied until PIN setup')
 const fields=page.locator('input[type=password]')
 await fields.nth(0).fill(pin);await fields.nth(1).fill(pin)
  await httpEvidence.drain()
  authAttemptA.pinSubmissionSequence=nextLifecycleSequence()
  authAttemptA.phase='pin-submitting'
 await page.getByRole('button',{name:'ตั้ง PIN'}).click()
 await page.waitForURL(/\/(?:dashboard|scanner)(?:\?|$)/)
  const initialPinReady=await requestGet(page.request,new URL('/api/fundamentals?symbols=AAPL',base).href)
  recordPinReadyControl(authAttemptA,initialPinReady)
  authAttemptA.phase='pin-ready'
 pinReady=true
  setStage('account-a-empty-portfolio-initialization')
  const accountAInitialization=startPortfolioInitialization('A')
  const accountAEmptyCount=await syntheticPortfolioCount(qaUser.id)
  assert.equal(accountAEmptyCount.length,0,'Fresh Account A must start with no portfolios')
  accountAInitialization.emptyDatabaseCount=accountAEmptyCount.length
  accountAInitialization.emptyDatabaseControlSequence=recordLifecycleControl({
   kind:'empty-portfolio-database-control',account:'A',portfolioCount:accountAEmptyCount.length,
  }).sequence
  for(const path of ['/api/portfolios','/api/performance','/api/transactions','/api/daily-analyses/today']){
   const requestSequence=nextLifecycleSequence()
   const response=await requestGet(page.request,new URL(path,base).href)
   const payload=await response.json()
   recordPortfolioRequiredControl(accountAInitialization,path,response,payload,requestSequence)
   assert.equal((await syntheticPortfolioCount(qaUser.id)).length,0,`${path} GET must not create a portfolio`)
  }
  for(const path of ['/dashboard','/transactions','/performance']){
   await navigate(new URL(path,base).href)
   if(path==='/dashboard'||path==='/transactions') await page.getByRole('heading',{name:'ยังไม่มีพอร์ตสำหรับบัญชีนี้'}).waitFor()
   assert.equal((await syntheticPortfolioCount(qaUser.id)).length,0,`Opening read-only ${path} must not create a portfolio`)
  }
  pass('Fresh Account A remains empty through portfolio, performance, transaction GETs and read-only page loads')
  setStage('account-a-first-portfolio-create')
  await httpEvidence.drain()
  accountAInitialization.creationStartedSequence=recordLifecycleControl({kind:'first-portfolio-creation-start',account:'A'}).sequence
  const accountAFirstPortfolioResponse=await requestPost(page.request,new URL('/api/portfolios',base).href,{data:{name:'Synthetic QA Portfolio A1'}})
  assert.equal(accountAFirstPortfolioResponse.status(),200)
  const accountAFirstPortfolio=(await accountAFirstPortfolioResponse.json()).portfolio
  const accountAAfterCreate=await syntheticPortfolioCount(qaUser.id)
  recordFirstPortfolioCreated(accountAInitialization,accountAFirstPortfolioResponse,accountAAfterCreate)
  const accountAList=await requestGet(page.request,new URL('/api/portfolios',base).href)
  assert.equal(accountAList.status(),200)
  assert.equal((await accountAList.json()).active_portfolio_id,accountAFirstPortfolio.id)
  pass('Account A first portfolio is created explicitly once and selected')
  // This is a separate Local Auth password-grant session for the same synthetic user,
  // verified by Auth /user; it is not extracted from the browser's cookie-backed session.
  const accountAAccessToken=await getVerifiedLocalUserAccessToken({
   baseUrl:process.env.NEXT_PUBLIC_SUPABASE_URL,
   expectedPort:process.env.QA_SUPABASE_API_PORT,
   anonKey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
   email,
   password,
   expectedUserId:qaUser.id,
  })
  pass('Local Auth verified a synthetic Account A JWT for PostgREST RLS controls')
 setStage('unlocked')
 const legacyInsert=await fetch(new URL('/rest/v1/watchlist?on_conflict=user_id,symbol',sb),localFetchOptions({
  method:'POST',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json',Prefer:'resolution=merge-duplicates'},
  body:JSON.stringify({user_id:qaUser.id,symbol:'IBM',target_price:123.45,note:'Synthetic legacy; read-only QA'})
 }))
 assert([200,201,204].includes(legacyInsert.status),`Synthetic legacy fixture insert failed with ${legacyInsert.status}`)
 const otherEmail='qa-other-'+randomUUID()+'@example.test'
 const otherPassword=randomBytes(24).toString('base64url')
 const otherUserResponse=await fetch(new URL('/auth/v1/admin/users',sb),localFetchOptions({
  method:'POST',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},
  body:JSON.stringify({email:otherEmail,password:otherPassword,email_confirm:true})
 }))
 assert.equal(otherUserResponse.status,200)
 const otherUser=await otherUserResponse.json()
 const otherLegacyInsert=await fetch(new URL('/rest/v1/watchlist?on_conflict=user_id,symbol',sb),localFetchOptions({
  method:'POST',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json',Prefer:'resolution=merge-duplicates'},
  body:JSON.stringify({user_id:otherUser.id,symbol:'NVDA',target_price:456,note:'synthetic foreign owner row'})
 }))
 assert([200,201,204].includes(otherLegacyInsert.status),`Synthetic other-owner row insert failed with ${otherLegacyInsert.status}`)
 const legacyRead=await requestGet(page.request,new URL('/api/watchlist/legacy',base).href)
 assert.equal(legacyRead.status(),200)
 const legacyData=await legacyRead.json()
 assert.equal(legacyData.scope,'account-unmapped-read-only')
 assert.equal(legacyData.portfolio_id,null)
 assert.equal(legacyData.items.length,1)
 assert.equal(legacyData.items[0].symbol,'IBM')
 assert.equal(legacyData.items[0].target_price,123.45)
 assert.equal(legacyData.items[0].note,'Synthetic legacy; read-only QA')
 assert(!legacyData.items.some(item=>item.symbol==='NVDA'),'Legacy endpoint must not return another user\'s row')
 assert(!('smart_alert' in legacyData.items[0])&&!('current_price' in legacyData.items[0]),'Legacy rows must not enter quote or alert processing')
 assert.equal((await requestPost(page.request,new URL('/api/watchlist/legacy',base).href,{data:{symbol:'MSFT'}})).status(),405,'Legacy endpoint must reject write methods')
 scannerMode='real-mine'
 const mineWithLegacy=await requestGet(page.request,new URL('/api/scanner?universe=mine',base).href)
 scannerMode='mock'
 assert.equal(mineWithLegacy.status(),200)
 assert.deepEqual((await mineWithLegacy.json()).items,[],'Account-level legacy rows must not be included in Scanner mine')
 pass('Legacy rows are PIN-protected, account-filtered, unmapped, and excluded from quotes/alerts and real Scanner mine')
 const live=await requestGet(page.request,new URL('/api/fundamentals?symbols=AAPL,MSFT',base).href)
 assert.equal(live.status(),200)
 const liveBody=await live.json()
 assert(liveBody.results.length===2&&liveBody.results.every(x=>x.providerStatus==='unavailable'&&x.sec.status==='unavailable'))
 pass('Unlocked real API returns provider-unavailable without credentials')
 const mine=await requestGet(page.request,new URL('/api/scanner?universe=mine',base).href)
 assert.equal(mine.status(),200);assert.deepEqual((await mine.json()).items,[])
 const daily=await requestGet(page.request,new URL('/api/daily-analyses/today',base).href)
 assert.equal(daily.status(),200,'Authenticated synthetic session must read empty daily analyses')
 pass('Empty synthetic portfolio mine API succeeds')
 setStage('scanner-after-setup')
 await navigate(new URL('/scanner',base).href)
 setStage('lock-transition')
 await httpEvidence.drain()
 pinReady=false
  const lockTransition={startedSequence:nextLifecycleSequence(),unlockedControlSequence:null}
  authAttemptA.pinLockTransitions.push(lockTransition)
 await page.getByRole('button',{name:/ล็อก/}).click()
 await page.waitForURL(/\/pin(?:\?|$)/)
 setStage('pin-unlock')
 await page.getByText('ใส่ PIN 6 หลัก').waitFor()
 const pinField=page.locator('input[type=password]').first()
 await pinField.fill('999999')
 await page.getByRole('button',{name:'เข้าสู่พอร์ต'}).click()
 await page.getByText('PIN ไม่ถูกต้อง').waitFor()
 assert.equal((await requestGet(page.request,new URL('/api/fundamentals?symbols=AAPL',base).href)).status(),401)
 await pinField.fill(pin)
 await page.getByRole('button',{name:'เข้าสู่พอร์ต'}).click()
 await page.waitForURL(/\/(?:dashboard|scanner)(?:\?|$)/)
  const pinUnlockControl=await requestGet(page.request,new URL('/api/fundamentals?symbols=AAPL',base).href)
  recordPinReadyControl(authAttemptA,pinUnlockControl,lockTransition)
  authAttemptA.phase='pin-ready'
 setStage('unlocked')
 pinReady=true
 pass('Real PIN rejects incorrect and accepts correct synthetic PIN')

 setStage('watchlist-missing-migration-ui')
 watchlistMode='missing-schema'
 await navigate(new URL('/scanner',base).href)
 await page.getByRole('button',{name:/^⭐ หุ้นที่เล็งไว้/}).click()
 await page.getByRole('alert').filter({hasText:'Synthetic missing portfolio Watchlist migration'}).waitFor()
 assert.equal(await page.getByText(/ยังไม่มีรายการ Watchlist ที่ผูกกับพอร์ตนี้/).count(),0,'Migration failure must not be presented as an empty portfolio Watchlist')
 assert(await page.getByText(/Legacy แสดงแยกแบบอ่านอย่างเดียว/).count()===1,'Legacy Watchlist must be disclosed separately as read-only and unmapped')
 pass('Missing portfolio Watchlist migration is reported without implying old data is absent')
 watchlistMode='normal'
 await navigate(new URL('/scanner',base).href)

 // Exercise portfolio-scoped Watchlist and rule APIs with a synthetic Auth/PIN user.
 setStage('watchlist-portfolio-isolation')
 const portfoliosResponse=await requestGet(page.request,new URL('/api/portfolios',base).href)
 assert.equal(portfoliosResponse.status(),200)
 const portfolioList=await portfoliosResponse.json()
 const portfolioA=portfolioList.portfolios.find(portfolio=>portfolio.id===portfolioList.active_portfolio_id)
 assert(portfolioA,'Synthetic user must have an active default portfolio')
 const collectionResponse=await requestPost(page.request,new URL('/api/watchlist/collections',base).href,{data:{name:'QA Collection A'}})
 assert.equal(collectionResponse.status(),201)
 const collectionA=(await collectionResponse.json()).collection
 const duplicateCollection=await requestPost(page.request,new URL('/api/watchlist/collections',base).href,{data:{name:'QA Collection A'}})
 assert.equal(duplicateCollection.status(),409,'Duplicate collection names in one portfolio must be rejected')
 const renameCollection=await requestPatch(page.request,new URL('/api/watchlist/collections',base).href,{data:{id:collectionA.id,name:'QA Collection A renamed'}})
 assert.equal(renameCollection.status(),200)
 assert.equal((await renameCollection.json()).collection.name,'QA Collection A renamed','Collection rename must persist within the selected portfolio')
 const itemAResponse=await requestPost(page.request,new URL('/api/watchlist',base).href,{data:{symbol:'AAPL',target_price:99,note:'Synthetic A',collection_id:collectionA.id,alert_enabled:true}})
 assert.equal(itemAResponse.status(),200)
 const secondPortfolioResponse=await requestPost(page.request,new URL('/api/portfolios',base).href,{data:{name:'Synthetic QA Portfolio B'}})
 assert.equal(secondPortfolioResponse.status(),200)
 const portfolioB=(await secondPortfolioResponse.json()).portfolio
 const emptyB=await requestGet(page.request,new URL('/api/watchlist',base).href)
 assert.equal(emptyB.status(),200)
 assert.equal((await emptyB.json()).items.length,0,'Portfolio B must not see Portfolio A Watchlist rows')
 const collectionBResponse=await requestPost(page.request,new URL('/api/watchlist/collections',base).href,{data:{name:'QA Collection B'}})
 assert.equal(collectionBResponse.status(),201)
 const collectionB=(await collectionBResponse.json()).collection
 const itemBResponse=await requestPost(page.request,new URL('/api/watchlist',base).href,{data:{symbol:'AAPL',target_price:101,note:'Synthetic B',collection_id:collectionB.id,alert_enabled:true}})
 assert.equal(itemBResponse.status(),200)
 const foreignCollectionResponse=await requestPost(page.request,new URL('/api/watchlist',base).href,{data:{symbol:'MSFT',target_price:400,collection_id:collectionA.id}})
 assert.equal(foreignCollectionResponse.status(),404,'A collection from another portfolio must be rejected')
 const selectA=await requestPost(page.request,new URL('/api/portfolios/select',base).href,{data:{portfolio_id:portfolioA.id}})
 assert.equal(selectA.status(),200)
 const visibleA=await requestGet(page.request,new URL('/api/watchlist',base).href)
 const visibleAData=await visibleA.json()
 assert.equal(visibleA.status(),200)
 assert.equal(visibleAData.items.length,1)
 assert.equal(visibleAData.items[0].target_price,99)
 assert.equal(visibleAData.items[0].note,'Synthetic A')
 assert.equal(visibleAData.items[0].collection_id,collectionA.id)
 await navigate(new URL('/scanner',base).href)
 await page.getByRole('button',{name:/^⭐ หุ้นที่เล็งไว้/}).click()
 const legacySection=page.getByRole('region',{name:'Legacy Watchlist · ระดับบัญชี · อ่านอย่างเดียว'})
 await legacySection.getByText('IBM',{exact:true}).waitFor()
 assert.equal(await legacySection.getByText('ราคาเป้าหมายเดิม').count(),1)
 assert.equal(await legacySection.getByText('Synthetic legacy; read-only QA').count(),1)
 assert.equal(await legacySection.locator('button').count(),0,'Legacy section must not provide mutation controls')
 pass('Legacy Watchlist is visibly separate and contains no mapping or mutation controls')
 const watchlistCard=page.locator('article').filter({hasText:'Synthetic A'})
 await watchlistCard.waitFor()
 assert(await watchlistCard.getByRole('heading',{name:'AAPL'}).count()===1)
 assert(await watchlistCard.getByText('ราคาเป้าหมาย').count()===1)
 await page.screenshot({path:`${dir}/watchlist-portfolio-a.png`,fullPage:true})
 pass('Authenticated Watchlist UI loads the selected portfolio item and target from Disposable Supabase')
 const themeButton=page.locator('button[title^="โหมดปัจจุบัน:"]')
 for(const theme of ['light','dark']){
  const currentTheme=await page.locator('html').getAttribute('data-theme')
  if(currentTheme!==theme){await themeButton.click();await page.waitForFunction(expected=>document.documentElement.getAttribute('data-theme')===expected,theme)}
    const watchlistContrast=await watchlistCard.evaluate(element=>{
   const parse=value=>{const match=value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);return match?[Number(match[1]),Number(match[2]),Number(match[3]),match[4]===undefined?1:Number(match[4])]:null}
   const blend=(front,back)=>[0,1,2].map(index=>Math.round(front[index]*front[3]+back[index]*(1-front[3]))).concat(1)
   const lum=color=>{const channels=color.slice(0,3).map(value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4});return 0.2126*channels[0]+0.7152*channels[1]+0.0722*channels[2]}
   const contrastFor=node=>{const foreground=parse(getComputedStyle(node).color);const layers=[];for(let current=node;current;current=current.parentElement){const background=parse(getComputedStyle(current).backgroundColor);if(background&&background[3]>0)layers.push(background)}let background=parse(getComputedStyle(document.documentElement).backgroundColor);background=background&&background[3]>0?background.slice(0,3).concat(1):[255,255,255,1];for(const layer of layers.reverse())background=blend(layer,background);if(!foreground)return 0;const a=lum(foreground),b=lum(background);return Number(((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2))}
   const targets=[['heading',element.querySelector('h3')],['collection',element.querySelector('div.min-w-0 > p')],['metric',element.querySelector('dl dt')],['source',Array.from(element.querySelectorAll(':scope > p')).find(node=>node.textContent.includes('Source'))],['note',Array.from(element.querySelectorAll(':scope > p')).find(node=>node.textContent==='Synthetic A')]]
   return Object.fromEntries(targets.map(([name,node])=>[name,node?contrastFor(node):null]))
  })
  if(theme==='light'){
   const unsupportedBackgrounds=await page.evaluate(()=>{
    const scope=Array.from(document.querySelectorAll('section')).find(element=>element.textContent.includes('Opportunity Scanner'))
    const unsupported=new Set(['bg-gray-950/30','bg-gray-950/40','bg-gray-900/30','bg-gray-800/50'])
    return scope?Array.from(scope.querySelectorAll('*')).flatMap(element=>Array.from(element.classList).filter(name=>unsupported.has(name))):['opportunity-scanner-not-found']
   })
   assert.deepEqual(unsupportedBackgrounds,[],'Light Watchlist surfaces must use app theme-compatible background utilities')
   pass('Light Watchlist surfaces use theme-compatible background utilities')
  }
  const measured=Object.values(watchlistContrast).filter(value=>value!==null)
  assert(measured.length>=4&&measured.every(value=>value>=4.5),`${theme} Watchlist card text contrast must be at least 4.5:1; measured ${JSON.stringify(watchlistContrast)}`)
  await page.screenshot({path:`${dir}/watchlist-${theme}-1440.png`,fullPage:true})
  pass(`Watchlist UI ${theme} theme contrast`)
 }
 for(const width of [375,768,1440]){
  await page.setViewportSize({width,height:1000})
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)
  assert.equal(overflow,false,`Watchlist UI must not overflow at ${width}px`)
  await page.screenshot({path:`${dir}/watchlist-portfolio-a-${width}.png`,fullPage:true})
  pass(`Watchlist UI responsive width ${width}px`)
 }
 await page.setViewportSize({width:1440,height:1000})
 const ruleResponse=await requestPost(page.request,new URL('/api/watchlist/rules',base).href,{data:{name:'Synthetic cash rule',rule_type:'CASH_AT_OR_BELOW',threshold:100}})
 assert.equal(ruleResponse.status(),201)
 const rule=(await ruleResponse.json()).rule
 const rulesBSelect=await requestPost(page.request,new URL('/api/portfolios/select',base).href,{data:{portfolio_id:portfolioB.id}})
 assert.equal(rulesBSelect.status(),200)
 const rulesB=await requestGet(page.request,new URL('/api/watchlist/rules',base).href)
 assert.equal(rulesB.status(),200)
 assert.equal((await rulesB.json()).rules.length,0,'Portfolio B must not see Portfolio A rules')
 await requestPost(page.request,new URL('/api/portfolios/select',base).href,{data:{portfolio_id:portfolioA.id}})
 const evalResponse=await requestPost(page.request,new URL('/api/watchlist/rules/evaluate',base).href)
 assert.equal(evalResponse.status(),200)
 const evaluation=(await evalResponse.json()).results.find(result=>result.id===rule.id)
 assert.equal(evaluation.status,'unavailable','Missing cash settings must not be coerced to zero')
 const deleteCollection=await requestDelete(page.request,new URL('/api/watchlist/collections?id='+encodeURIComponent(collectionA.id),base).href)
 assert.equal(deleteCollection.status(),200)
 const preserved=await requestGet(page.request,new URL('/api/watchlist',base).href)
 const preservedItem=(await preserved.json()).items[0]
 assert.equal(preservedItem.symbol,'AAPL')
 assert.equal(preservedItem.collection_id,null,'Deleting a collection must preserve items and clear only the collection reference')
 await requestDelete(page.request,new URL('/api/watchlist?symbol=AAPL',base).href)
 await requestPost(page.request,new URL('/api/portfolios/select',base).href,{data:{portfolio_id:portfolioB.id}})
 await requestDelete(page.request,new URL('/api/watchlist?symbol=AAPL',base).href)
 await requestDelete(page.request,new URL('/api/watchlist/collections?id='+encodeURIComponent(collectionB.id),base).href)
 await requestPost(page.request,new URL('/api/portfolios/select',base).href,{data:{portfolio_id:portfolioA.id}})
 await requestDelete(page.request,new URL('/api/watchlist/rules?id='+encodeURIComponent(rule.id),base).href)
 pass('Watchlist, Collection, and investment rules remain isolated across two selected portfolios; same Symbol can hold different targets')
 pass('Deleting a Collection preserves its Watchlist rows; incomplete rule inputs remain unavailable')

  // Authenticated v1.40 composition uses only the selected synthetic portfolio and performs no implicit provider refresh.
  setStage('investment-command-center-live-disposable')
  const guardCountBefore=await readNetworkGuardAttempts()
  const transactionsSnapshot=await requestGet(page.request,new URL('/api/transactions',base).href)
  assert.equal(transactionsSnapshot.status(),200)
  assert.match(transactionsSnapshot.headers()['cache-control']??'',/no-store/)
  const transactionsBody=await transactionsSnapshot.json()
  assert.equal(transactionsBody.portfolio.id,portfolioA.id)
  assert.deepEqual(transactionsBody.items,[],'Fresh synthetic ledger must remain empty')
  const performanceSnapshot=await requestGet(page.request,new URL('/api/performance',base).href)
  assert.equal(performanceSnapshot.status(),200)
  assert.match(performanceSnapshot.headers()['cache-control']??'',/no-store/)
  const performanceBody=await performanceSnapshot.json()
  assert.equal(performanceBody.portfolio.id,portfolioA.id)
  const commandSnapshot=await requestGet(page.request,new URL('/api/investment-command-center',base).href)
  assert.equal(commandSnapshot.status(),200)
  assert.match(commandSnapshot.headers()['cache-control']??'',/no-store/)
  const commandBody=await commandSnapshot.json()
  assert.equal(commandBody.portfolio.id,portfolioA.id)
  assert.equal(commandBody.sections.market.status,'NOT_REQUESTED','Opening a portfolio snapshot must not request market providers')
  const smartDipSnapshot=await requestGet(page.request,new URL('/api/smart-dip',base).href)
  assert.equal(smartDipSnapshot.status(),200)
  assert.equal((await smartDipSnapshot.json()).providerRequests,0,'Smart Dip candidate loading must not refresh providers')
  await navigate(new URL('/command-center',base).href)
  await page.getByRole('heading',{name:/ศูนย์รวมการลงทุน/}).waitFor()
  assert(await page.getByText(/ไม่ใช่ข้อมูล Real-time/).count()>0)
  assert.equal(await page.getByRole('button',{name:/ส่งคำสั่งซื้อ|ส่งคำสั่งขาย|ซื้อจริง|ขายจริง/}).count(),0,'Command Center must not add transaction execution controls')
  for(const theme of ['light','dark']){
   const themeButton=page.locator('button[title^="โหมดปัจจุบัน:"]')
   if(await page.locator('html').getAttribute('data-theme')!==theme){await themeButton.click();await page.waitForFunction(value=>document.documentElement.getAttribute('data-theme')===value,theme)}
   for(const width of [375,768,1440]){
    await page.setViewportSize({width,height:1000})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Command Center horizontal overflow at ${width}px ${theme}`)
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
    const relevant=axe.violations.filter(v=>v.impact==='critical'||v.impact==='serious'||v.id==='color-contrast')
    assert.equal(relevant.length,0,`Command Center axe findings at ${width}px ${theme}: `+JSON.stringify(relevant.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))))
    pass(`v1.40 Command Center axe and responsive ${width}px ${theme}`)
   }
  }
  assert.equal(await readNetworkGuardAttempts(),guardCountBefore,'Opening the command center must not attempt outbound provider requests')
  await page.setViewportSize({width:1440,height:1000})
  pass('v1.40 snapshot is selected-portfolio scoped, no-store, no-refresh on open, and has no trading execution')

 // Exercise v1.37 risk and SEC UI with synthetic-only API fixtures.
 setStage('risk-dashboard')
 riskMode='loading'
 await navigate(new URL('/risk',base).href)
 await page.getByText('กำลังคำนวณ Portfolio Risk...').waitFor()
 await page.getByRole('heading',{name:'🛡️ ความเสี่ยงพอร์ต'}).waitFor()
  await page.getByRole('heading',{name:/Smart Dip Buying/}).waitFor()
 const scenarioSelect=page.locator('label').filter({hasText:'ประเภทสถานการณ์'}).locator('select')
 const scenarioPanel=page.locator('section').filter({hasText:'จำลองสถานการณ์'}).last()
 await scenarioPanel.getByText('-$200.00',{exact:true}).waitFor()
 await scenarioSelect.selectOption('industry')
 await scenarioPanel.getByText('-$160.00',{exact:true}).waitFor()
 await scenarioSelect.selectOption('symbols')
 await scenarioPanel.getByText('-$160.00',{exact:true}).waitFor()
 const allocationNames=await page.locator('input[aria-label^="Target allocation percentage for "]').evaluateAll(inputs=>inputs.map(input=>input.getAttribute('aria-label')).sort())
 assert.deepEqual(allocationNames,['Target allocation percentage for AAPL','Target allocation percentage for DIME','Target allocation percentage for MSFT'])
 pass('All synthetic Target Allocation fields expose accessible names that identify their symbols')
 riskMode='error'
 await page.reload()
 await page.getByText('โหลด Risk ไม่สำเร็จ').waitFor()
 await page.emulateMedia({colorScheme:'light'})
 if(await page.locator('html').getAttribute('data-theme')!=='light') await page.locator('button[title^="โหมดปัจจุบัน:"]').click()
 const riskErrorAxe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
 assert.equal(riskErrorAxe.violations.filter(v=>v.impact==='critical'||v.impact==='serious'||v.id==='color-contrast').length,0,'Risk error state must pass critical/serious axe checks in light theme')
 pass('Risk unavailable/error state passes critical/serious Light Theme axe checks')
 riskMode='empty'
 await page.reload()
 await page.getByText('ยังไม่มี Holdings ที่มีราคาปัจจุบันสำหรับคำนวณ').waitFor()
 const riskEmptyAxe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
 assert.equal(riskEmptyAxe.violations.filter(v=>v.impact==='critical'||v.impact==='serious'||v.id==='color-contrast').length,0,'Risk empty state must pass critical/serious axe checks in light theme')
 pass('Risk empty state passes critical/serious Light Theme axe checks')
 riskMode='synthetic'
 await page.reload()
 await page.getByRole('heading',{name:'🛡️ ความเสี่ยงพอร์ต'}).waitFor()
 pass('Risk Dashboard loading and market/industry/symbol stress simulations render from synthetic fixtures')
 secRiskMode='error'
 setStage('risk-sec-error')
 await page.getByRole('button',{name:'โหลดข้อมูล SEC'}).click()
 await page.getByRole('alert').filter({hasText:'Synthetic SEC risk unavailable'}).waitFor()
 secRiskMode='synthetic'
 setStage('risk-dashboard')
 await page.getByRole('button',{name:'โหลดข้อมูล SEC'}).click()
 await page.getByText('AAPL · Synthetic Issuer').waitFor()
 await page.locator('summary').filter({hasText:'วิธีคำนวณและเอกสาร SEC'}).click()
 await page.getByText(/Synthetic Accession/).waitFor()
 pass('SEC Risk/Filing UI handles synthetic failure and renders issuer, metrics, and filing provenance without live SEC requests')
 for(const appTheme of ['light','dark']){
  await page.emulateMedia({colorScheme:appTheme})
  const themeButton=page.locator('button[title^="โหมดปัจจุบัน:"]')
  if(await page.locator('html').getAttribute('data-theme')!==appTheme) await themeButton.click()
  await page.waitForFunction(theme=>document.documentElement.getAttribute('data-theme')===theme,appTheme)
  await assertRiskAxe(page,appTheme,dir)
  pass(`Risk/SEC UI accessibility axe checks ${appTheme}`)
 }
 for(const width of [375,768,1440]){
  await page.setViewportSize({width,height:1000})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`Risk UI overflow at ${width}px`)
  for(const appTheme of ['light','dark']){
   await page.evaluate(theme=>{document.documentElement.setAttribute('data-theme',theme);window.dispatchEvent(new Event('stock-portfolio-theme-change'))},appTheme)
   await assertRiskAxe(page,`${appTheme}-${width}`,dir)
  }
  const riskTable=page.getByRole('region',{name:'ความเสี่ยงรายหุ้น — ตารางเลื่อนแนวนอน'})
  await riskTable.focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await riskTable.evaluate(element=>document.activeElement===element),true,'Risk table scroll region must be keyboard reachable')
  pass(`Risk/SEC UI responsive width ${width}px`)
 }
 await page.setViewportSize({width:1440,height:1000})

 // Real same-context Account A -> logout -> Account B, including B's own PIN setup.
  await httpEvidence.drain()
  const accountAPreLogoutPinControl=await requestGet(page.request,new URL('/api/fundamentals?symbols=AAPL',base).href)
  recordPinReadyControl(authAttemptA,accountAPreLogoutPinControl)
 setStage('account-switch-a-logout')
  const authAttemptB=beginAuthAttempt('B',null)
  authAttemptB.previousAccount='A'
  authAttemptB.previousAccountPinReadyControlSequence=authAttemptA.pinReadyControlSequence
  authAttemptB.logoutTransitionStartedSequence=nextLifecycleSequence()
  authAttemptB.phase='logout-transition'
 activeAccount='B'
 await page.getByRole('button',{name:'⚙️ บัญชี'}).click()
 await page.getByRole('menuitem',{name:'ออกจากระบบ'}).click()
 await page.waitForURL(/\/login(?:\?|$)/)
 authReady=false;pinReady=false
  const accountBLoggedOutControl=await recordUnauthenticatedControl(
   await requestGet(page.request,new URL('/api/pin/status',base).href),'B'
  )
  authAttemptB.unauthenticatedControlSequence=accountBLoggedOutControl.sequence
 setStage('account-switch-b-login')
 await page.locator('input[type="email"]').fill(otherEmail)
 await page.locator('input[type="password"]').fill(otherPassword)
 setStage('account-switch-b-authenticating')
  authAttemptB.phase='authenticating'
  authAttemptB.authRequestSequence=nextLifecycleSequence()
 await page.getByRole('button',{name:'เข้าสู่ระบบ'}).click()
 await page.waitForURL(/\/(?:pin|dashboard)(?:\?|$)/)
 if(new URL(page.url()).pathname!=='/pin') await navigate(new URL('/pin',base).href)
 const bPinStatus=await requestGet(page.request,new URL('/api/pin/status',base).href)
 assert.equal(bPinStatus.status(),200,'Account B Auth must be established before PIN setup')
  const bPinStatusBody=await bPinStatus.json()
  assert.equal(bPinStatusBody.hasPin,false,'New Account B must not already have a PIN')
  recordAuthStatusControl(authAttemptB,bPinStatus,bPinStatusBody)
  authAttemptB.phase='pin-setup'
 authReady=true
 setStage('account-switch-b-pin-setup')
 await page.getByText('ตั้ง PIN 6 หลัก').waitFor()
 const otherPinFields=page.locator('input[type=password]')
 await otherPinFields.nth(0).fill(pin);await otherPinFields.nth(1).fill(pin)
  await httpEvidence.drain()
  authAttemptB.pinSubmissionSequence=nextLifecycleSequence()
  authAttemptB.phase='pin-submitting'
 await page.getByRole('button',{name:'ตั้ง PIN'}).click()
 await page.waitForURL(/\/(?:dashboard|scanner)(?:\?|$)/)
  const accountBPinReady=await requestGet(page.request,new URL('/api/fundamentals?symbols=AAPL',base).href)
  recordPinReadyControl(authAttemptB,accountBPinReady)
  authAttemptB.phase='pin-ready'
 pinReady=true
  setStage('account-switch-b-empty-portfolio-initialization')
  const accountBInitialization=startPortfolioInitialization('B')
  const accountBEmptyCount=await syntheticPortfolioCount(otherUser.id)
  assert.equal(accountBEmptyCount.length,0,'Fresh Account B must start with no portfolios')
  accountBInitialization.emptyDatabaseCount=accountBEmptyCount.length
  accountBInitialization.emptyDatabaseControlSequence=recordLifecycleControl({
   kind:'empty-portfolio-database-control',account:'B',portfolioCount:accountBEmptyCount.length,
  }).sequence
  for(const path of ['/api/portfolios','/api/performance','/api/transactions','/api/daily-analyses/today']){
   const requestSequence=nextLifecycleSequence()
   const response=await requestGet(page.request,new URL(path,base).href)
   const payload=await response.json()
   recordPortfolioRequiredControl(accountBInitialization,path,response,payload,requestSequence)
   assert.equal((await syntheticPortfolioCount(otherUser.id)).length,0,`${path} GET must not create a portfolio for Account B`)
  }
  for(const path of ['/dashboard','/transactions','/performance']){
   await navigate(new URL(path,base).href)
   if(path==='/dashboard'||path==='/transactions') await page.getByRole('heading',{name:'ยังไม่มีพอร์ตสำหรับบัญชีนี้'}).waitFor()
   assert.equal((await syntheticPortfolioCount(otherUser.id)).length,0,`Opening read-only ${path} must not create an Account B portfolio`)
  }
  pass('Fresh Account B remains empty through read-only APIs and pages after its own Auth/PIN setup')
  setStage('account-switch-b-first-portfolio-create')
  await httpEvidence.drain()
  accountBInitialization.creationStartedSequence=recordLifecycleControl({kind:'first-portfolio-creation-start',account:'B'}).sequence
  const accountBFirstPortfolioResponse=await requestPost(page.request,new URL('/api/portfolios',base).href,{data:{name:'Synthetic QA Portfolio B1'}})
  assert.equal(accountBFirstPortfolioResponse.status(),200)
  const accountBFirstPortfolio=(await accountBFirstPortfolioResponse.json()).portfolio
  const accountBAfterCreate=await syntheticPortfolioCount(otherUser.id)
  recordFirstPortfolioCreated(accountBInitialization,accountBFirstPortfolioResponse,accountBAfterCreate)
 setStage('account-switch-b-unlocked')
 const bPortfoliosResponse=await requestGet(page.request,new URL('/api/portfolios',base).href)
 assert.equal(bPortfoliosResponse.status(),200,'Account B must establish its own authenticated portfolio context')
 const bPortfolioList=await bPortfoliosResponse.json()
 const bPortfolio=bPortfolioList.portfolios.find(portfolio=>portfolio.id===bPortfolioList.active_portfolio_id)
  assert(bPortfolio&&bPortfolio.id===accountBFirstPortfolio.id,'Account B must use its explicitly created first portfolio')
 assert(![portfolioA.id,portfolioB.id].includes(bPortfolio.id),'Account B default portfolio must not reuse either Account A portfolio')
 const bLegacy=await requestGet(page.request,new URL('/api/watchlist/legacy',base).href)
 assert.equal(bLegacy.status(),200)
 assert.deepEqual((await bLegacy.json()).items.map(item=>item.symbol),['NVDA'],'Account B may only see its own synthetic legacy row')
 const bMine=await requestGet(page.request,new URL('/api/scanner?universe=mine',base).href)
 assert.equal(bMine.status(),200)
 assert.deepEqual((await bMine.json()).items,[],'Account B Scanner mine must exclude Account B legacy-only data and Account A holdings/watchlists')
 const foreignPortfolioAttempt=await requestPost(page.request,new URL('/api/portfolios/select',base).href,{data:{portfolio_id:portfolioA.id}})
 assert([403,404,409].includes(foreignPortfolioAttempt.status()),`Account B must be denied Account A portfolio; received ${foreignPortfolioAttempt.status()}`)
 const bMineAfterForeign=await requestGet(page.request,new URL('/api/scanner?universe=mine',base).href)
 assert.equal(bMineAfterForeign.status(),200)
 assert.deepEqual((await bMineAfterForeign.json()).items,[],'Denied cross-account portfolio selection must not expose old or foreign Scanner data')
  const accountARlsPortfolios=await fetch(new URL(`/rest/v1/portfolios?select=id&user_id=eq.${encodeURIComponent(otherUser.id)}`,sb),localFetchOptions({
   headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,authorization:'Bearer '+accountAAccessToken},
  }))
  assert.equal(accountARlsPortfolios.status,200,'Authenticated Account A direct RLS query must complete')
  assert.deepEqual(await accountARlsPortfolios.json(),[],'Actual PostgREST RLS must hide Account B portfolio rows from Account A')
  const authenticatedDecrypt=await fetch(new URL('/rest/v1/rpc/get_decrypted_holdings',sb),localFetchOptions({
   method:'POST',headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,authorization:'Bearer '+accountAAccessToken,'content-type':'application/json'},
   body:JSON.stringify({p_user_id:qaUser.id,p_portfolio_id:portfolioA.id,p_enc_key:'synthetic-not-a-secret'}),
  }))
  assert([401,403].includes(authenticatedDecrypt.status),`Authenticated role must be denied service-only decryption RPC; received ${authenticatedDecrypt.status}`)
  pass('Live Disposable PostgREST RLS hides Account B portfolio from Account A; authenticated role is denied key-bearing decryption RPC')
 pass('Same browser context Account A logout → Account B login/PIN preserves portfolio and Scanner isolation')

 await navigate(new URL('/scanner',base).href)
 await page.getByRole('button',{name:/พื้นฐาน \/ มูลค่า/}).click()
 await page.getByRole('heading',{name:'วิเคราะห์พื้นฐานและมูลค่า'}).waitFor()
 assert.equal(await page.getByRole('heading',{name:'SEC EDGAR · Annual GAAP EPS จาก 10-K'}).count(),0)
 pass('Empty Fundamentals state')
 const symbols=page.getByLabel('สัญลักษณ์หุ้น คั่นด้วยจุลภาค')
 await symbols.fill('AAPL,MSFT');mode='loading'
 await page.getByRole('button',{name:'โหลดข้อมูล'}).click()
 await page.getByText('กำลังขอข้อมูลสาธารณะจากผู้ให้บริการ').waitFor()
  const loadingButton=page.getByRole('button',{name:'กำลังโหลด…'})
  assert(await loadingButton.isDisabled(),'Load button must be disabled while requesting')
  assert.equal(await loadingButton.evaluate(element=>getComputedStyle(element).opacity),'1','Disabled button label must remain fully visible')
  pass('Loading state disables repeat requests without fading the button')
 await page.getByRole('heading',{name:'SEC EDGAR · Annual GAAP EPS จาก 10-K'}).waitFor()
 mode='synthetic'
 assert(await page.getByText('Different · แตกต่างกัน').count()>0)
 assert(await page.getByText(/ชื่อบริษัทจาก SEC Mapping และ CompanyFacts แตกต่างกัน/).count()>0)
 assert(await page.getByText(/Unverified/).count()>0)
 const valuation=page.locator('section[aria-labelledby="valuation-title"]')
 assert.equal(await valuation.count(),1,'P/E Scenario section is present')
 assert.equal(await valuation.locator('dl').count(),0)
 assert(await valuation.getByText(/ไม่แสดงราคา Scenario/).count()>0)
 pass('Synthetic SEC warning, Unverified comparison, and closed P/E render')
  const modeSnapshots=new Map()
  for(const systemTheme of ['light','dark']){
   await page.emulateMedia({colorScheme:systemTheme})
   for(const appTheme of ['light','dark']){
    const themeButton=page.locator('button[title^="โหมดปัจจุบัน:"]')
    if(await page.locator('html').getAttribute('data-theme')!==appTheme) await themeButton.click()
    await page.waitForFunction(theme=>document.documentElement.getAttribute('data-theme')===theme,appTheme)
    await page.reload()
    await page.addStyleTag({content:'nextjs-portal{display:none!important}'})
    assert.equal(await page.locator('html').getAttribute('data-theme'),appTheme,'App theme preference must persist after reload')
    await page.getByRole('button',{name:/พื้นฐาน \/ มูลค่า/}).click()
    await page.getByRole('heading',{name:'วิเคราะห์พื้นฐานและมูลค่า'}).waitFor()
    const matrixSymbols=page.getByLabel('สัญลักษณ์หุ้น คั่นด้วยจุลภาค')
    await matrixSymbols.fill('AAPL,MSFT')
    await page.getByRole('button',{name:'โหลดข้อมูล'}).click()
    await page.getByRole('heading',{name:'SEC EDGAR · Annual GAAP EPS จาก 10-K'}).waitFor()
    await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState==='finished'))
    const snapshot=await captureThemeSnapshot(page)
    themeMatrix.push({systemTheme,appTheme,palette:snapshot.palette,contrast:snapshot.contrast})
    await writeFile(dir+'/theme-matrix-evidence.json',JSON.stringify({status:'IN_PROGRESS',themeMatrix},null,2))
    await page.screenshot({path:dir+`/theme-${systemTheme}-system-${appTheme}-app.png`,fullPage:true})
    assert.equal(snapshot.theme,appTheme)
    assert.equal(snapshot.panel.background,appTheme==='light'?'rgb(255, 255, 255)':'rgb(3, 7, 18)')
    assert.equal(snapshot.panel.color,appTheme==='light'?'rgb(17, 24, 39)':'rgb(243, 244, 246)')
    assertContrast(snapshot,'panelTitle')
    assertContrast(snapshot,'supportingText')
    assertContrast(snapshot,'issuerWarning')
    assertContrast(snapshot,'comparisonStatus')
    assertContrast(snapshot,'themeButton')
    assertContrast(snapshot,'activeNavigation')
    const previous=modeSnapshots.get(appTheme)
    if(previous){
     assert.deepEqual(snapshot.palette,previous.palette,`App ${appTheme} colors must not depend on system ${systemTheme} preference`)
     pass(`System ${systemTheme} + App ${appTheme}: palette matches the same App theme under the other OS preference`)
    }else{
     modeSnapshots.set(appTheme,snapshot)
     pass(`System ${systemTheme} + App ${appTheme}: palette is internally consistent with contrast checks`)
    }
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
    const relevant=axe.violations.filter(v=>v.impact==='critical'||v.impact==='serious'||v.id==='color-contrast')
    assert.equal(relevant.length,0,`Axe serious/critical or contrast violations in ${systemTheme}/${appTheme}: `+JSON.stringify(relevant.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))))
    pass(`Axe WCAG A/AA plus all color-contrast checks: System ${systemTheme} + App ${appTheme}`)
    if(systemTheme==='light'){
     for(const width of [375,768,1440]){
      await page.setViewportSize({width,height:1000})
      const dims=await page.evaluate(()=>[innerWidth,document.documentElement.scrollWidth])
      assert(dims[1]<=dims[0]+1,`Horizontal overflow at ${width}px in ${appTheme} theme`)
      await page.screenshot({path:dir+`/fundamentals-${appTheme}-${width}.png`,fullPage:true})
      pass(`${appTheme} theme responsive width ${width}px`)
     }
    }
   }
  }
  await page.setViewportSize({width:1440,height:1000})
  const focusInput=page.getByLabel('สัญลักษณ์หุ้น คั่นด้วยจุลภาค')
  await focusInput.focus()
  await page.keyboard.press('Tab')
  const focusStyle=await page.evaluate(()=>({tag:document.activeElement?.tagName,shadow:getComputedStyle(document.activeElement).boxShadow,outline:getComputedStyle(document.activeElement).outlineStyle}))
  assert.equal(focusStyle.tag,'BUTTON')
  assert(focusStyle.shadow!=='none'||focusStyle.outline!=='none','Keyboard focus must remain visible')
  pass('Keyboard navigation reaches the primary action with visible focus')
 setStage('fundamentals-provider-error')
 mode='error';await symbols.fill('AAPL')
 await page.getByRole('button',{name:'โหลดข้อมูล'}).click()
 await page.getByRole('alert').filter({hasText:'Synthetic provider error'}).waitFor()
 pass('Synthetic provider error state')
 assert.equal(outside,0,'Browser tried to contact non-local host')
 pass('Browser made no non-local requests')
  setStage('http-evidence-finalization')
  await httpEvidence.close(context)
  assert.equal(outside,0,'Browser tried to contact non-local host during evidence finalization')
  setStage('http-failure-classification')
   const expectedFailures=browserHttpFailures.filter(failure=>isExpectedHttpFailure(failure,lifecycleEvidence))
  const unexpectedConsoleErrors=unexpectedConsoleHttpErrors(browserConsoleErrors,expectedFailures)
   assertNoUnexpectedHttpFailures(browserHttpFailures,lifecycleEvidence)
  assert.equal(browserRuntimeErrors.length,0,'Browser runtime errors occurred')
  assert.deepEqual(unexpectedConsoleErrors,[],'Unexpected browser console errors: '+JSON.stringify(unexpectedConsoleErrors))
  pass('No browser runtime or unhandled console errors; expected PIN/provider HTTP failures are tracked separately')
 } catch(error) {
  let responseEvidenceFinalizationFailed=false
  if(context)try{await httpEvidence.close(context)}catch{responseEvidenceFinalizationFailed=true}
  let blocked=0
  try{blocked=(await readFile(process.env.QA_NETWORK_GUARD_LOG,'utf8')).split('\n').filter(Boolean).length}catch{}
  const message=String(error?.message??'QA assertion failed')
   .split('\n')[0]
   .replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
   .replace(/(authorization|cookie|password|secret|token)\s*[:=]\s*[^\s,}]+/gi,'$1=[redacted]')
   .slice(0,500)
  if(!runnerTerminated)await writeFile(dir+'/results.json',JSON.stringify({
   status:'FAIL',
   environment:'Disposable local Supabase loopback only',
   providers:'live credentials absent; synthetic UI fixture',
   data:'synthetic only',
   failure:{stage:qaStage,name:String(error?.name??'Error').slice(0,80),message},
   finalStage:qaStage,
   checks,
   passedChecks:checks.length,
   authLifecycle:lifecycleEvidence,
   responseEvidence:{...httpEvidence.summary(),finalizationFailed:responseEvidenceFinalizationFailed},
   browserHttpFailures,
   consoleErrors:browserConsoleErrors.filter(item=>item.kind!=='http-status').length,
   runtimeErrors:browserRuntimeErrors.length,
   blockedExternalAttempts:blocked,
   blockedBrowserRequests:outside,
  },null,2))
  throw error
 } finally {clearTimeout(deadlineTimer);await browser?.close()}
let blocked=0
try{blocked=(await readFile(process.env.QA_NETWORK_GUARD_LOG,'utf8')).split('\n').filter(Boolean).length}catch{}
 setStage('complete')
pass('Server outbound attempts blocked by guard: '+blocked)
 await writeFile(dir+'/results.json',JSON.stringify({status:'PASS',environment:'Disposable local Supabase loopback only',providers:'live credentials absent; synthetic UI fixture',checks,passedChecks:checks.length,themeMatrix,finalStage:qaStage,authLifecycle:lifecycleEvidence,responseEvidence:httpEvidence.summary(),consoleErrors:browserConsoleErrors.filter(error=>error.kind!=='http-status').length,expectedHttpConsoleErrors:browserConsoleErrors.filter(error=>error.kind==='http-status'),browserHttpFailures,runtimeErrors:browserRuntimeErrors.length,blockedExternalAttempts:blocked,blockedBrowserRequests:outside,data:'synthetic only'},null,2))
await writeFile(dir+'/theme-matrix-evidence.json',JSON.stringify({status:'PASS',themeMatrix},null,2))
console.log('Authenticated Browser QA passed: '+checks.length+' checks; external network is blocked by policy.')
clearTimeout(deadlineTimer)

async function assertRiskAxe(page,label,evidenceDir){
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
 const relevant=axe.violations.filter(v=>v.impact==='critical'||v.impact==='serious'||v.id==='color-contrast')
 const computed=await page.locator('[data-app-shell-nav] button, [data-app-shell-nav] nav a, .risk-dashboard .text-gray-500, .risk-dashboard .text-gray-600').evaluateAll(elements=>elements.map(element=>{
  const style=getComputedStyle(element)
  const ancestors=[]
  for(let parent=element;parent;parent=parent.parentElement){
   const parentStyle=getComputedStyle(parent)
   ancestors.push({tag:parent.tagName,classes:parent.className,color:parentStyle.color,background:parentStyle.backgroundColor,opacity:parentStyle.opacity})
  }
  return {tag:element.tagName,classes:element.className,color:style.color,background:style.backgroundColor,transition:style.transitionProperty,ancestors}
 }))
 await writeFile(`${evidenceDir}/risk-axe-${label}.json`,JSON.stringify({label,violations:relevant,computed},null,2))
 assert.equal(relevant.length,0,`Risk UI axe violations ${label}: `+JSON.stringify(relevant.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))))
}

function fixture(){
 const now=new Date().toISOString()
 const metrics=[['eps','currency/share'],['pe','x'],['ps','x'],['pb','x'],['ev_ebitda','x']]
 const make=(symbol,mapping,facts,match,cik)=>({
  symbol,companyName:symbol==='AAPL'?'Apple Inc.':'Microsoft Corporation',industry:'Technology',
  profileCurrency:'USD',profileStatus:'available',profileFetchedAt:now,providerStatus:'available',fetchedAt:now,
  observations:metrics.flatMap(([id,unit])=>['TTM','ANNUAL','QUARTERLY'].map(period=>({id,label:id,period,value:id==='eps'?6.15:id==='pe'?22:null,currency:null,unit,source:'Finnhub',sourceField:'synthetic',fetchedAt:now,sourceUpdatedAt:null,freshness:'unknown',periodEnd:null,status:id==='eps'||id==='pe'?'available':'missing'}))),
  earnings:{status:'unavailable',date:null,hour:null,fetchedAt:null,source:null},earningsResultsStatus:'unverified',
  sec:{status:'unverified',reason:'Synthetic fixture only; no live SEC request.',identity:{ticker:symbol,cik,entityName:mapping,exchange:'NASDAQ',status:'unverified',reason:'Synthetic'},issuerIdentityStatus:'unverified',companyFactsEntityName:facts,issuerNameMatch:match,basic:{status:'unavailable',fact:null,reason:'Synthetic only'},diluted:{status:'unavailable',fact:null,reason:'Synthetic only'},fetchedAt:now,source:'SEC EDGAR'}
 })
 return {requestedAt:now,sources:{fundamentals:'Finnhub',earnings:'Finnhub',annualEps:'SEC EDGAR'},earningsResultsStatus:'unverified',results:[
  make('AAPL','Apple Inc.','Apple Inc.','exact','0000320193'),
  make('MSFT','Microsoft Corp.','Microsoft Corporation','different','0000789019')
 ]}
}

function riskFixture(){
 const positions=[
  {symbol:'AAPL',shares:8,current_price:100,market_value:800,weight_pct:80,equity_weight_pct:80,industry:'Technology',stop_loss:null,stop_state:'MISSING',stop_risk_amount:null,stop_risk_pct_position:null,risk_contribution_pct:null},
  {symbol:'MSFT',shares:2,current_price:100,market_value:200,weight_pct:20,equity_weight_pct:20,industry:'Software',stop_loss:null,stop_state:'MISSING',stop_risk_amount:null,stop_risk_pct_position:null,risk_contribution_pct:null},
 ]
 return {summary:{equity_market_value:1000,cash_balance:0,investable_portfolio_value:1000,cash_pct:0,largest_position_pct:80,largest_sector_pct:80,stop_coverage_pct:0,quantified_stop_risk_amount:0,quantified_stop_risk_pct:0,max_stop_loss_amount:null,max_stop_loss_pct:null,unprotected_symbols:['AAPL','MSFT'],breached_stop_symbols:[]},positions,sectors:[{industry:'Technology',market_value:800,weight_pct:80,equity_weight_pct:80},{industry:'Software',market_value:200,weight_pct:20,equity_weight_pct:20}],suggestions:[{severity:'WATCH',message:'Synthetic concentration warning'}],warnings:['Synthetic stale-price warning'],balances:{dime_balance:0,initial_capital:1000,dime_included_in_risk_total:false},methodology:{source:'synthetic'},data_quality:{priced_holding_count:2,unpriced_symbols:[],price_freshness:'unknown'}}
}

function secRiskFixture(){
 const now=new Date().toISOString()
 const evidence={concept:'SyntheticAssetsCurrent',value:1000,unit:'USD',periodStart:null,periodEnd:'2025-12-31',form:'10-K',filed:'2026-02-01',accession:'Synthetic Accession',sourceUrl:'https://www.sec.gov/Archives/edgar/data/synthetic/filing-index.htm'}
 const indicator={status:'available',reason:'Synthetic fixture',value:1,unit:'ratio',periodEnd:'2025-12-31',filed:'2026-02-01',freshness:'fresh',evidence:[evidence]}
 const unavailable={status:'unavailable',reason:'Synthetic fixture only',value:null,unit:null,periodEnd:null,filed:null,freshness:'unknown',evidence:[]}
 return {results:[{symbol:'AAPL',risk:{status:'available',reason:'Synthetic fixture',identity:{cik:'0000000000',entityName:'Synthetic Issuer',exchange:'NASDAQ',status:'unverified'},companyFactsEntityName:'Synthetic Issuer',issuerNameMatch:'exact',fetchedAt:now,liquidity:indicator,liabilitiesToAssets:indicator,operatingCashFlow:unavailable,signals:['Synthetic risk signal'],methodology:['Synthetic only; no SEC request']},filings:[{cik:'0000000000',accession:'Synthetic Accession',form:'10-K',filingDate:'2026-02-01',sourceUrl:evidence.sourceUrl,contentAnalyzed:false}],filingStatus:'available'}],totalSymbols:1,metrics:{requestAttempts:0,maxHttpAttempts:12,deadlineMs:45000},coverage:{totalPortfolioSymbols:1,returnedSymbols:1,omittedSymbols:0,selectedSymbols:['AAPL'],selectionMethod:'synthetic fixture'}}
}

async function captureThemeSnapshot(page){
 const snapshot=await page.evaluate(()=>{
  const parse=value=>{
   const match=value.match(/rgba?\(([^)]+)\)/)
   if(!match)return null
   const parts=match[1].split(',').map(part=>Number.parseFloat(part.trim()))
   return [parts[0],parts[1],parts[2],parts[3]??1]
  }
  const blend=(foreground,background)=>foreground.slice(0,3).map((value,index)=>Math.round(value*foreground[3]+background[index]*(1-foreground[3])))
  const luminance=color=>{
   const linear=color.slice(0,3).map(value=>{const channel=value/255;return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4})
   return 0.2126*linear[0]+0.7152*linear[1]+0.0722*linear[2]
  }
  const target=selector=>{
   const element=document.querySelector(selector)
   if(!element)return null
   const style=getComputedStyle(element)
   const layers=[]
   for(let current=element;current;current=current.parentElement){
    const color=parse(getComputedStyle(current).backgroundColor)
    if(color&&color[3]>0)layers.push(color)
   }
   let background=parse(getComputedStyle(document.documentElement).backgroundColor)
   background=background&&background[3]>0?background.slice(0,3):[255,255,255]
   for(const layer of layers.reverse())background=blend(layer,background)
   const foreground=parse(style.color)
   const a=luminance(foreground),b=luminance(background)
   const ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)
   return {color:style.color,backgroundColor:style.backgroundColor,effectiveBackground:`rgb(${background.join(', ')})`,contrast:Number(ratio.toFixed(2)),fontSize:style.fontSize,fontWeight:style.fontWeight}
  }
  return {
   theme:document.documentElement.getAttribute('data-theme'),
   panel:{background:getComputedStyle(document.querySelector('section[aria-labelledby="fundamentals-title"]')).backgroundColor,color:getComputedStyle(document.querySelector('section[aria-labelledby="fundamentals-title"]')).color},
   panelTitle:target('#fundamentals-title'),
   supportingText:target('section[aria-labelledby="fundamentals-title"] header > p'),
   issuerWarning:target('section[aria-label="ข้อมูลผู้ออกหลักทรัพย์ SEC MSFT"] p[role="status"]'),
   comparisonStatus:target('section[aria-labelledby="sec-eps-title"] > p[role="status"]'),
   themeButton:target('button[title^="โหมดปัจจุบัน:"]'),
   activeNavigation:target('nav[aria-label="เมนูหลัก"] a.bg-blue-600.text-white'),
  }
 })
 assert(snapshot.panelTitle&&snapshot.supportingText&&snapshot.issuerWarning&&snapshot.comparisonStatus&&snapshot.themeButton&&snapshot.activeNavigation,'Expected visible theme test elements are missing')
 const palette={theme:snapshot.theme,panel:snapshot.panel,panelTitle:{color:snapshot.panelTitle.color,background:snapshot.panelTitle.effectiveBackground},supportingText:{color:snapshot.supportingText.color,background:snapshot.supportingText.effectiveBackground},issuerWarning:{color:snapshot.issuerWarning.color,background:snapshot.issuerWarning.backgroundColor,effectiveBackground:snapshot.issuerWarning.effectiveBackground},comparisonStatus:{color:snapshot.comparisonStatus.color,background:snapshot.comparisonStatus.effectiveBackground},themeButton:{color:snapshot.themeButton.color,background:snapshot.themeButton.backgroundColor,effectiveBackground:snapshot.themeButton.effectiveBackground},activeNavigation:{color:snapshot.activeNavigation.color,background:snapshot.activeNavigation.backgroundColor,effectiveBackground:snapshot.activeNavigation.effectiveBackground}}
 const contrast={panelTitle:snapshot.panelTitle.contrast,supportingText:snapshot.supportingText.contrast,issuerWarning:snapshot.issuerWarning.contrast,comparisonStatus:snapshot.comparisonStatus.contrast,themeButton:snapshot.themeButton.contrast,activeNavigation:snapshot.activeNavigation.contrast}
 return {theme:snapshot.theme,panel:snapshot.panel,palette,contrast}
}

function assertContrast(snapshot,key){
 const ratio=snapshot.contrast[key]
 assert(Number.isFinite(ratio)&&ratio>=4.5,`${key} text contrast must be at least 4.5:1; received ${ratio}`)
}
