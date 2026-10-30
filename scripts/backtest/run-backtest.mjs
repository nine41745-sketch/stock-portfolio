import fs from 'node:fs/promises'
import path from 'node:path'
import { getTechnicalIndicators } from '@/lib/indicators'
import { scoreScannerCandidate, SCANNER_UNIVERSES, dedupeScannerSymbols } from '@/lib/stock-scanner'
import { buildStockCheck, calculateStockCheckStopLoss } from '@/lib/stock-check'
import { selectPreliminary, selectAutomatic } from '@/lib/today-candidates'
import { SNAPSHOT_DIR, RESULTS_DIR } from './paths.mjs'

const cacheDir = process.argv[2] ?? SNAPSHOT_DIR
const outDir = process.argv[3] ?? RESULTS_DIR
const weekLimit = Number(process.env.BACKTEST_WEEK_LIMIT ?? 0)
const manifest = JSON.parse(await fs.readFile(path.join(cacheDir, 'manifest.json'), 'utf8'))
const NativeDate = Date
const snapshots = new Map()
for (const symbol of manifest.symbols) snapshots.set(symbol, JSON.parse(await fs.readFile(path.join(cacheDir, `${symbol}.json`), 'utf8')))
const symbols = dedupeScannerSymbols(Object.values(SCANNER_UNIVERSES))
const daily = new Map(symbols.concat('SPY').map(symbol => [symbol, snapshots.get(symbol)?.bars ?? []]))

function weekStart(date) {
  const d = new NativeDate(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0,10)
}
function weeklyBars(bars) {
  const groups = new Map()
  for (const bar of bars) {
    const key=weekStart(bar.date),prev=groups.get(key)
    if (!prev) groups.set(key,{date:key,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume})
    else { prev.high=Math.max(prev.high,bar.high);prev.low=Math.min(prev.low,bar.low);prev.close=bar.close;prev.volume+=bar.volume }
  }
  return [...groups.values()]
}
function chartResponse(symbol, period1, period2, interval) {
  const source=daily.get(symbol)
  if (!source) throw new Error(`Missing cached symbol ${symbol}`)
  let bars=source.filter(bar=>{const time=Date.parse(`${bar.date}T00:00:00Z`);return time>=period1*1000&&time<=period2*1000})
  if(interval==='1wk') bars=weeklyBars(bars)
  const payload={chart:{error:null,result:[{timestamp:bars.map(bar=>Math.floor(Date.parse(`${bar.date}T00:00:00Z`)/1000)),indicators:{quote:[{close:bars.map(b=>b.close),high:bars.map(b=>b.high),low:bars.map(b=>b.low),volume:bars.map(b=>b.volume)}]}}]}}
  return payload
}
let clock=NativeDate.now()
globalThis.Date=class BacktestDate extends NativeDate {
  constructor(...args){super(...(args.length?args:[clock]))}
  static now(){return clock}
}
globalThis.fetch=async input=>{
  const url=new URL(typeof input==='string'?input:input.url)
  const match=url.pathname.match(/\/chart\/([^/]+)/)
  if(match){const body=chartResponse(decodeURIComponent(match[1]),Number(url.searchParams.get('period1')),Number(url.searchParams.get('period2')),url.searchParams.get('interval'));return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}})}
  if(url.hostname==='stooq.com') return new Response('Date,Open,High,Low,Close,Volume\n',{status:200})
  throw new Error(`Unexpected offline network request: ${url.origin}${url.pathname}`)
}
const context={signal:new AbortController().signal,canStart:()=>true,run:operation=>operation(new AbortController().signal)}
const lastDate=daily.get('SPY').at(-1).date
const end=new NativeDate(`${lastDate}T00:00:00Z`)
const start=new NativeDate(end);start.setUTCFullYear(start.getUTCFullYear()-5)
const signalDates=[]
const friday=new NativeDate(start)
friday.setUTCDate(friday.getUTCDate()+((5-friday.getUTCDay()+7)%7))
for(;friday<=end;friday.setUTCDate(friday.getUTCDate()+7)) signalDates.push(friday.toISOString().slice(0,10))
const dates=weekLimit>0?signalDates.slice(0,weekLimit):signalDates
const dailyIndex=new Map([...daily].map(([symbol,bars])=>[symbol,new Map(bars.map((bar,index)=>[bar.date,index]))]))
const rawSignals=[]
const marketSnapshots=[]
let unavailableFridayTicker=0

function withClock(date, operation) {
  clock=Date.parse(`${date}T23:59:59.999Z`)
  return operation()
}
function libraryInputs(technical,spy,earningsDays=null){
  const rs20=technical.return20dPct===null||spy.return20dPct===null?null:Math.round((technical.return20dPct-spy.return20dPct)*100)/100
  const rs60=technical.return60dPct===null||spy.return60dPct===null?null:Math.round((technical.return60dPct-spy.return60dPct)*100)/100
  const earningsStatus=earningsDays===null?'none':'found'
  const scored=scoreScannerCandidate({trend:technical.trend,rsi14:technical.rsi14,weeklyRsi14:technical.weeklyRsi14,
    macdHistogram:technical.macd.histogram,lastClose:technical.lastClose,ema50:technical.ema50,support:technical.scannerSupport,
    resistance:technical.scannerResistance,volumeRatio:technical.scannerVolumeRatio,week52High:technical.week52High,
    week52Low:technical.week52Low,relativeStrength20:rs20,relativeStrength60:rs60,earningsDays,earningsStatus})
  const plan=buildStockCheck({trend:technical.trend,setup:scored.setup,score:scored.score,price:technical.lastClose,ema50:technical.ema50,
    ema200:technical.ema200,atr14:technical.atr14,support:technical.scannerSupport,swingLow:technical.scannerSwingLow,
    resistance:technical.scannerResistance,rsi14:technical.rsi14,weeklyRsi14:technical.weeklyRsi14,macdHistogram:technical.macd.histogram,
    volumeRatio:technical.scannerVolumeRatio,relativeStrength20:rs20,relativeStrength60:rs60,week52High:technical.week52High,
    week52Low:technical.week52Low,earningsDays,earningsStatus,pe:null})
  return {scored,plan,rs20,rs60}
}
function displayGroup(plan){
  if(plan.decision==='BUY_NOW')return plan.buyMode==='FIRST_TRANCHE'?'ซื้อไม้แรก':'ซื้อได้ตอนนี้'
  if(plan.decision==='BUY_ON_PULLBACK')return 'รอย่อ'
  if(plan.decision==='WAIT_FOR_BREAKOUT')return 'รอ Breakout'
  if(plan.decision==='SKIP_POOR_RR')return 'SKIP_POOR_RR'
  if(plan.decision==='AVOID')return 'ข้าม'
  return 'เฝ้าดู'
}

for(let di=0;di<dates.length;di++){
  const date=dates[di]
  const spy=await withClock(date,()=>getTechnicalIndicators('SPY',context))
  const candidates=[]
  for(const symbol of symbols){
    const technical=await withClock(date,()=>getTechnicalIndicators(symbol,context))
    if(technical.lastClose===null||technical.ema200===null||technical.atr14===null){unavailableFridayTicker++;continue}
    const {scored,plan,rs20,rs60}=libraryInputs(technical,spy)
    const bars=daily.get(symbol),idx=dailyIndex.get(symbol).get(technical.lastBarAt?.slice(0,10))
    const currentBar=idx===undefined?null:bars[idx]
    candidates.push({symbol,score:scored.score,setup:scored.setup,trend:technical.trend,price:technical.lastClose,
      ema50:technical.ema50,ema200:technical.ema200,support:technical.scannerSupport,
      riskReward:plan.riskRewardAtEntry,earnings:null,
      technical,plan,scored,rs20,rs60,currentBar,index:idx,date})
    marketSnapshots.push({date,symbol,technicalDate:technical.lastBarAt?.slice(0,10)??null,price:technical.lastClose,atr:technical.atr14,
      trend:technical.trend,score:scored.score,setup:scored.setup})
  }
  const preliminary=selectPreliminary(candidates)
  const validated=selectAutomatic(preliminary)
  for(const candidate of validated){
    const group=displayGroup(candidate.plan)
    const p=candidate.plan
    rawSignals.push({date,symbol:candidate.symbol,group,decision:p.decision,buyMode:p.buyMode,score:candidate.score,price:candidate.price,
      atr:candidate.technical.atr14,rrNow:p.riskRewardNow,rrAtEntry:p.riskRewardAtEntry,entryZone:p.entryZone,
      plannedEntry:p.entryZone?(p.entryZone.low+p.entryZone.high)/2:null,stop:p.stopLoss,target:p.target1,
      breakoutTrigger:p.breakoutTrigger,scannerVolumeRatio:candidate.technical.scannerVolumeRatio,
      support:candidate.technical.scannerSupport,resistance:candidate.technical.scannerResistance,
      swingLow:candidate.technical.scannerSwingLow,ema50:candidate.technical.ema50,ema200:candidate.technical.ema200,
      technicalDate:candidate.technical.lastBarAt})
  }
  process.stdout.write(`week ${di+1}/${dates.length} ${date}: ${candidates.length} candidates, ${validated.length} validated\n`)
}
globalThis.Date=NativeDate
await fs.mkdir(outDir,{recursive:true})
await fs.writeFile(path.join(outDir,'signals.json'),JSON.stringify(rawSignals))
await fs.writeFile(path.join(outDir,'market-snapshots.json'),JSON.stringify(marketSnapshots))
await fs.writeFile(path.join(outDir,'engine-manifest.json'),JSON.stringify({baseSha:'d13f9b52f4a97fdc4c3a7957eb2489d644d46141',snapshotRequestedAt:manifest.requestedAt,
  sourceEnd:lastDate,signalStart:dates[0]??null,signalEnd:dates.at(-1)??null,fridays:dates.length,tickerCount:symbols.length,validatedSignals:rawSignals.length,
  earnings:'none',signalWeekLimit:weekLimit||null,unavailableFridayTicker,selectionNote:'Candidate.riskReward uses buildStockCheck-derived RR rather than the API route private price/support/resistance ratio; API route itself cannot be imported without Supabase/Next dependencies.',
  weeklyNote:'Native Yahoo weekly OHLCV is reconstructed from cached daily bars using calendar weeks; the production provider uses 1wk Yahoo bars.',
  functions:['getTechnicalIndicators','scoreScannerCandidate (which invokes private classifySetup)','buildStockCheck','selectPreliminary','selectAutomatic']} ,null,2))
console.log(JSON.stringify({fridays:dates.length,rawSignals:rawSignals.length,signalStart:dates[0],signalEnd:dates.at(-1),unavailableFridayTicker,outDir}))
