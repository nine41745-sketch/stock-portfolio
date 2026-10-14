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
const dir = process.env.QA_ARTIFACT_DIR ?? '.local-artifacts/authenticated-browser-qa'
await mkdir(dir,{recursive:true})
const checks=[]
const themeMatrix=[]
const browserConsoleErrors=[]
const browserHttpFailures=[]
const browserRuntimeErrors=[]
let qaStage='startup'
const requestStages=new WeakMap()
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
 page.on('console',message=>{
  if(message.type()==='error'){
   const status=message.text().match(/status of (\d{3})/)
   browserConsoleErrors.push(status?{kind:'http-status',status:Number(status[1])}:{kind:'console-error'})
  }
 })
 page.on('pageerror',()=>browserRuntimeErrors.push('page-error'))
 page.on('request',request=>requestStages.set(request,qaStage))
 page.on('response',async response=>{
  if(response.status()>=400){
   let authGate='unclassified'
   if(response.status()===401){
    const body=await response.text().catch(()=> '')
    if(body.includes('PIN required'))authGate='pin-required'
    else if(body.includes('Unauthorized'))authGate='unauthorized'
   }
   browserHttpFailures.push({path:new URL(response.url()).pathname,status:response.status(),stage:requestStages.get(response.request())??'unknown',authGate})
  }
 })
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
 qaStage='anonymous'
 const anonymous=await context.newPage()
 await anonymous.goto(new URL('/scanner',base).href)
 await anonymous.waitForURL(/\/login(?:\?|$)/)
 assert.equal((await anonymous.request.get(new URL('/api/pin/status',base).href)).status(),401)
 pass('Anonymous page and API are rejected')
 qaStage='login'
 await page.goto(new URL('/login',base).href)
 await page.addStyleTag({content:'nextjs-portal{display:none!important}'})
 await page.locator('input[type="email"]').fill(email)
 await page.locator('input[type="password"]').fill(password)
 await page.getByRole('button',{name:'เข้าสู่ระบบ'}).click()
 await page.waitForURL(/\/(?:pin|dashboard)(?:\?|$)/)
 if(new URL(page.url()).pathname!=='/pin') await page.goto(new URL('/pin',base).href)
 qaStage='pin-setup'
 await page.getByText('ตั้ง PIN 6 หลัก').waitFor()
 const locked=await page.request.get(new URL('/api/fundamentals?symbols=AAPL',base).href)
 assert.equal(locked.status(),401)
 assert.match((await locked.json()).error,/PIN/i)
 pass('Authenticated session is denied until PIN setup')
 const fields=page.locator('input[type=password]')
 await fields.nth(0).fill(pin);await fields.nth(1).fill(pin)
 await page.getByRole('button',{name:'ตั้ง PIN'}).click()
 await page.waitForURL(/\/(?:dashboard|scanner)(?:\?|$)/)
 qaStage='unlocked'
 const live=await page.request.get(new URL('/api/fundamentals?symbols=AAPL,MSFT',base).href)
 assert.equal(live.status(),200)
 const liveBody=await live.json()
 assert(liveBody.results.length===2&&liveBody.results.every(x=>x.providerStatus==='unavailable'&&x.sec.status==='unavailable'))
 pass('Unlocked real API returns provider-unavailable without credentials')
 const mine=await page.request.get(new URL('/api/scanner?universe=mine',base).href)
 assert.equal(mine.status(),200);assert.deepEqual((await mine.json()).items,[])
 const daily=await page.request.get(new URL('/api/daily-analyses/today',base).href)
 assert.equal(daily.status(),200,'Authenticated synthetic session must read empty daily analyses')
 pass('Empty synthetic portfolio mine API succeeds')
 qaStage='scanner-after-setup'
 await page.goto(new URL('/scanner',base).href)
 qaStage='lock-transition'
 await page.getByRole('button',{name:/ล็อก/}).click()
 await page.waitForURL(/\/pin(?:\?|$)/)
 qaStage='pin-unlock'
 await page.getByText('ใส่ PIN 6 หลัก').waitFor()
 const pinField=page.locator('input[type=password]').first()
 await pinField.fill('999999')
 await page.getByRole('button',{name:'เข้าสู่พอร์ต'}).click()
 await page.getByText('PIN ไม่ถูกต้อง').waitFor()
 assert.equal((await page.request.get(new URL('/api/fundamentals?symbols=AAPL',base).href)).status(),401)
 await pinField.fill(pin)
 await page.getByRole('button',{name:'เข้าสู่พอร์ต'}).click()
 await page.waitForURL(/\/(?:dashboard|scanner)(?:\?|$)/)
 qaStage='unlocked'
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
 mode='error';await symbols.fill('AAPL')
 await page.getByRole('button',{name:'โหลดข้อมูล'}).click()
 await page.getByRole('alert').filter({hasText:'Synthetic provider error'}).waitFor()
 pass('Synthetic provider error state')
 assert.equal(outside,0,'Browser tried to contact non-local host')
 pass('Browser made no non-local requests')
  const expectedHttpFailure=({path,status,stage,authGate})=>
    (path==='/api/pin/status'&&status===401)||
    (path==='/api/pin/verify'&&status===401)||
    (path==='/api/daily-analyses/today'&&status===401&&['anonymous','login','pin-setup'].includes(stage))||
    (path==='/api/daily-analyses/today'&&status===401&&['lock-transition','pin-unlock'].includes(stage)&&authGate==='pin-required')||
    (path==='/api/fundamentals'&&status===503)
  const unexpectedHttpFailures=browserHttpFailures.filter(failure=>!expectedHttpFailure(failure))
  const allowedHttpStatuses=new Set(browserHttpFailures.filter(expectedHttpFailure).map(failure=>failure.status))
  const unexpectedConsoleErrors=browserConsoleErrors.filter(error=>error.kind!=='http-status'||!allowedHttpStatuses.has(error.status))
  assert.deepEqual(unexpectedHttpFailures,[],'Unexpected failed browser responses: '+JSON.stringify(unexpectedHttpFailures))
  assert.equal(browserRuntimeErrors.length,0,'Browser runtime errors occurred')
  assert.deepEqual(unexpectedConsoleErrors,[],'Unexpected browser console errors: '+JSON.stringify(unexpectedConsoleErrors))
  pass('No browser runtime or unhandled console errors; expected PIN/provider HTTP failures are tracked separately')
 await context.close()
} finally {await browser.close()}
let blocked=0
try{blocked=(await readFile(process.env.QA_NETWORK_GUARD_LOG,'utf8')).split('\n').filter(Boolean).length}catch{}
pass('Server outbound attempts blocked by guard: '+blocked)
await writeFile(dir+'/results.json',JSON.stringify({status:'PASS',environment:'Disposable local Supabase loopback only',providers:'live credentials absent; synthetic UI fixture',checks,themeMatrix,consoleErrors:browserConsoleErrors.filter(error=>error.kind!=='http-status').length,expectedHttpConsoleErrors:browserConsoleErrors.filter(error=>error.kind==='http-status'),browserHttpFailures,runtimeErrors:browserRuntimeErrors.length,blockedExternalAttempts:blocked,blockedBrowserRequests:outside,data:'synthetic only'},null,2))
await writeFile(dir+'/theme-matrix-evidence.json',JSON.stringify({status:'PASS',themeMatrix},null,2))
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
