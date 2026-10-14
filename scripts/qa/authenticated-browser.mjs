import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const base = new URL(process.env.QA_BASE_URL ?? '')
const local = h => ['localhost', '127.0.0.1', '::1'].includes(h)
const sb = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
assert(local(base.hostname) && base.protocol === 'http:' && base.port === '3000')
assert(local(sb.hostname) && sb.protocol === 'http:' && sb.port === '54321')
assert(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY)
assert(!process.env.FINNHUB_API_KEY && !process.env.SEC_USER_AGENT && !process.env.GROQ_API_KEY)
const dir = '.local-artifacts/authenticated-browser-qa'
await mkdir(dir,{recursive:true})
const checks=[]
const pass=name=>checks.push({name,status:'PASS'})
const email='qa-'+randomUUID()+'@example.test'
const password=randomBytes(24).toString('base64url')
const pin='583104'
const created=await fetch(new URL('/auth/v1/admin/users',sb),{
  method:'POST',
  headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json'},
  body:JSON.stringify({email,password,email_confirm:true}),
})
assert.equal(created.status,200)
pass('Synthetic user created by local Auth Admin')
let outside=0, mode='synthetic'
const browser=await chromium.launch({headless:true})
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
 const page=await context.newPage()
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url())
  if(!local(u.hostname)||(u.port!=='3000'&&u.origin!==process.env.NEXT_PUBLIC_SUPABASE_URL)){outside++;await route.abort('blockedbyclient');return}
  if(u.pathname==='/api/fundamentals'){
   if(mode==='loading') await new Promise(resolve=>setTimeout(resolve,1000))
   if(mode==='error') await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic provider error'})})
   else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture())})
   return
  }
  if(u.pathname==='/api/scanner') return route.fulfill({status:200,contentType:'application/json',body:'{"items":[]}'})
  if(u.pathname==='/api/watchlist'&&route.request().method()==='GET')
   return route.fulfill({status:200,contentType:'application/json',body:'{"items":[]}'})
  return route.continue()
 })
 const anonymous=await context.newPage()
 await anonymous.goto(new URL('/scanner',base).href)
 await anonymous.waitForURL(/\/login(?:\?|$)/)
 assert.equal((await anonymous.request.get(new URL('/api/pin/status',base).href)).status(),401)
 pass('Anonymous page and API are rejected')
 await page.goto(new URL('/login',base).href)
 await page.locator('input[type="email"]').fill(email)
 await page.locator('input[type="password"]').fill(password)
 await page.getByRole('button',{name:'เข้าสู่ระบบ'}).click()
 await page.waitForURL(/\/(?:pin|dashboard)(?:\?|$)/)
 if(new URL(page.url()).pathname!=='/pin') await page.goto(new URL('/pin',base).href)
 await page.getByText('ตั้ง PIN 6 หลัก').waitFor()
 const locked=await page.request.get(new URL('/api/fundamentals?symbols=AAPL',base).href)
 assert.equal(locked.status(),401)
 assert.match((await locked.json()).error,/PIN/i)
 pass('Authenticated session is denied until PIN setup')
 const fields=page.locator('input[type=password]')
 await fields.nth(0).fill(pin);await fields.nth(1).fill(pin)
 await page.getByRole('button',{name:'ตั้ง PIN'}).click()
 await page.waitForURL(/\/(?:dashboard|scanner)(?:\?|$)/)
 const live=await page.request.get(new URL('/api/fundamentals?symbols=AAPL,MSFT',base).href)
 assert.equal(live.status(),200)
 const liveBody=await live.json()
 assert(liveBody.results.length===2&&liveBody.results.every(x=>x.providerStatus==='unavailable'&&x.sec.status==='unavailable'))
 pass('Unlocked real API returns provider-unavailable without credentials')
 const mine=await page.request.get(new URL('/api/scanner?universe=mine',base).href)
 assert.equal(mine.status(),200);assert.deepEqual((await mine.json()).items,[])
 pass('Empty synthetic portfolio mine API succeeds')
 await page.goto(new URL('/scanner',base).href)
 await page.getByRole('button',{name:/ล็อก/}).click()
 await page.waitForURL(/\/pin(?:\?|$)/)
 await page.getByText('ใส่ PIN 6 หลัก').waitFor()
 const pinField=page.locator('input[type=password]').first()
 await pinField.fill('999999')
 await page.getByRole('button',{name:'เข้าสู่พอร์ต'}).click()
 await page.getByText('PIN ไม่ถูกต้อง').waitFor()
 assert.equal((await page.request.get(new URL('/api/fundamentals?symbols=AAPL',base).href)).status(),401)
 await pinField.fill(pin)
 await page.getByRole('button',{name:'เข้าสู่พอร์ต'}).click()
 await page.waitForURL(/\/(?:dashboard|scanner)(?:\?|$)/)
 pass('Real PIN rejects incorrect and accepts correct synthetic PIN')
 await page.goto(new URL('/scanner',base).href)
 await page.getByRole('button',{name:/พื้นฐาน \/ มูลค่า/}).click()
 await page.getByRole('heading',{name:'วิเคราะห์พื้นฐานและมูลค่า'}).waitFor()
 assert.equal(await page.getByRole('heading',{name:'SEC EDGAR · Annual GAAP EPS จาก 10-K'}).count(),0)
 pass('Empty Fundamentals state')
 const symbols=page.getByLabel('สัญลักษณ์หุ้น คั่นด้วยจุลภาค')
 await symbols.fill('AAPL,MSFT');mode='loading'
 await page.getByRole('button',{name:'โหลดข้อมูล'}).click()
 await page.getByText('กำลังขอข้อมูลสาธารณะจากผู้ให้บริการ').waitFor()
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
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
 const severe=axe.violations.filter(v=>v.impact==='critical'||v.impact==='serious')
 if(severe.length) await writeFile(dir+'/axe-serious.json',JSON.stringify(severe.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>n.target)})),null,2))
 assert.equal(severe.length,0,'Axe serious/critical findings: '+JSON.stringify(severe.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))))
 pass('Axe WCAG A/AA serious and critical scan')
 if((await page.locator('html').getAttribute('data-theme'))!=='dark') await page.getByRole('button',{name:/โหมดสว่าง.*โหมดมืด/}).click()
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark')
 for(const width of [375,768,1440]){
  await page.setViewportSize({width,height:1000})
  const dims=await page.evaluate(()=>[innerWidth,document.documentElement.scrollWidth])
  assert(dims[1]<=dims[0]+1,'Horizontal overflow at '+width+'px')
  await page.screenshot({path:dir+'/fundamentals-dark-'+width+'.png',fullPage:true})
  pass('Dark theme responsive width '+width+'px')
 }
 await page.getByRole('button',{name:/โหมดมืด.*โหมดสว่าง/}).click()
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light')
 await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState==='finished'))
 const lightAxe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()
 const lightSevere=lightAxe.violations.filter(v=>v.impact==='critical'||v.impact==='serious')
 if(lightSevere.length) await writeFile(dir+'/axe-light-serious.json',JSON.stringify(lightSevere.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,failureSummary:n.failureSummary,checks:[...n.any,...n.all,...n.none].map(check=>({id:check.id,data:check.data}))}))})),null,2))
 assert.equal(lightSevere.length,0,'Light theme axe serious/critical findings: '+JSON.stringify(lightSevere.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,checks:[...n.any,...n.all,...n.none].map(check=>({id:check.id,data:check.data}))}))}))))
 for(const width of [375,768,1440]){
  await page.setViewportSize({width,height:1000})
  const dims=await page.evaluate(()=>[innerWidth,document.documentElement.scrollWidth])
  assert(dims[1]<=dims[0]+1,'Light theme horizontal overflow at '+width+'px')
  await page.screenshot({path:dir+'/fundamentals-light-'+width+'.png',fullPage:true})
  pass('Light theme screenshot width '+width+'px')
 }
 mode='error';await symbols.fill('AAPL')
 await page.getByRole('button',{name:'โหลดข้อมูล'}).click()
 await page.getByRole('alert').filter({hasText:'Synthetic provider error'}).waitFor()
 pass('Synthetic provider error state')
 assert.equal(outside,0,'Browser tried to contact non-local host')
 pass('Browser made no non-local requests')
 await context.close()
} finally {await browser.close()}
let blocked=0
try{blocked=(await readFile(process.env.QA_NETWORK_GUARD_LOG,'utf8')).split('\n').filter(Boolean).length}catch{}
pass('Server outbound attempts blocked by guard: '+blocked)
await writeFile(dir+'/results.json',JSON.stringify({status:'PASS',environment:'Disposable local Supabase loopback only',providers:'live credentials absent; synthetic UI fixture',checks,blockedExternalAttempts:blocked,blockedBrowserRequests:outside,data:'synthetic only'},null,2))
console.log('Authenticated Browser QA passed: '+checks.length+' checks; external network is blocked by policy.')

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
