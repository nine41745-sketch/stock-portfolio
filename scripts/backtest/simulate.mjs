import fs from 'node:fs/promises'
import path from 'node:path'
import { calculateStockCheckStopLoss } from '@/lib/stock-check'
import { SNAPSHOT_DIR, RESULTS_DIR } from './paths.mjs'

const cacheDir=process.argv[2]??SNAPSHOT_DIR,resultDir=process.argv[3]??RESULTS_DIR
const symbols=JSON.parse(await fs.readFile(path.join(cacheDir,'manifest.json'),'utf8')).symbols.filter(s=>s!=='SPY')
const signals=JSON.parse(await fs.readFile(path.join(resultDir,'signals.json'),'utf8'))
const market=JSON.parse(await fs.readFile(path.join(resultDir,'market-snapshots.json'),'utf8'))
const barsBySymbol=new Map()
for(const symbol of [...symbols,'SPY'])barsBySymbol.set(symbol,JSON.parse(await fs.readFile(path.join(cacheDir,`${symbol}.json`),'utf8')).bars)
const marketByDateTicker=new Map(market.map(row=>[`${row.date}:${row.symbol}`,row]))
const indices=new Map([...barsBySymbol].map(([symbol,bars])=>[symbol,new Map(bars.map((bar,index)=>[bar.date,index]))]))
const multipliers=[1,1.5,2]
const slippage=0.001

function groupFor(signal){
  if(signal.group==='ซื้อไม้แรก')return `ซื้อไม้แรก · R:R NOW ${signal.rrNow<1.5?'<1.5':'>=1.5'}`
  return signal.group
}
function dateAfter(date,days){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d}
function dateDiff(a,b){return Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000)}
function nextIndex(symbol,date){
  const map=indices.get(symbol),bars=barsBySymbol.get(symbol)
  if(!map||!bars)return null
  const at=map.get(date)
  if(at!==undefined)return at+1<bars.length?at+1:null
  const pos=bars.findIndex(row=>row.date>date)
  return pos>=0?pos:null
}
function buildVariableStop(signal,mult){
  const zone=signal.entryZone,atr=signal.atr
  if(!zone||!Number.isFinite(atr)||atr<=0)return signal.stop
  const planned=(zone.low+zone.high)/2
  const swingLowStop=Number.isFinite(signal.swingLow)?signal.swingLow-atr*0.1:zone.low-atr*1.5
  const atrStop=planned-atr*1.5
  return calculateStockCheckStopLoss({swingLowStop,atrStop,entryLow:zone.low,plannedEntry:planned,minRisk:Math.max(mult*atr,0.02*signal.price)})
}
function simulateExit(symbol,entryIndex,entryRaw,stop,target,maxDays=20){
  const bars=barsBySymbol.get(symbol)
  if(!bars||entryIndex==null||!Number.isFinite(entryRaw)||!Number.isFinite(stop)||!Number.isFinite(target)||entryRaw<=stop)return null
  const risk=entryRaw-stop
  for(let offset=0;offset<maxDays;offset++){
    const index=entryIndex+offset,bar=bars[index]
    if(!bar)break
    let exitPrice=null,reason=null
    if(offset===0&&bar.open!=null&&bar.open<=stop){exitPrice=bar.open;reason='stop-gap'}
    else if(offset===0&&bar.open!=null&&bar.open>=target){exitPrice=bar.open;reason='target-gap'}
    else if(bar.low<=stop){exitPrice=stop;reason='stop'}
    else if(bar.high>=target){exitPrice=target;reason='target'}
    else if(offset===maxDays-1){exitPrice=bar.close;reason='time'}
    if(exitPrice!==null){
      const netEntry=entryRaw*(1+slippage),netExit=exitPrice*(1-slippage)
      return {entryDate:bars[entryIndex].date,exitDate:bar.date,entryRaw,exitPrice,reason,
        r:(netExit-netEntry)/risk,win:reason==='target'||reason==='target-gap'}
    }
  }
  return null
}
function fillSignal(signal,stopMultiplier,exitModel='generic'){
  const bars=barsBySymbol.get(signal.symbol),signalBar=signal.technicalDate?.slice(0,10)
  const at=indices.get(signal.symbol)?.get(signalBar)
  if(at===undefined)return {attempted:true,trade:null,reason:'no-signal-bar'}
  const maxEntry=10
  let entryIndex=null,entryRaw=null,stop=null,target=null
  if(['ซื้อได้ตอนนี้','ซื้อไม้แรก'].includes(signal.group)){
    entryIndex=at+1
    if(!bars[entryIndex]||bars[entryIndex].open==null)return {attempted:true,trade:null,reason:'no-next-open'}
    entryRaw=bars[entryIndex].open
    stop=exitModel==='plan'?signal.stop:buildVariableStop(signal,stopMultiplier)
    target=signal.target
  }else if(signal.group==='รอย่อ'){
    const zone=signal.entryZone
    if(!zone)return {attempted:true,trade:null,reason:'missing-entry-zone'}
    for(let i=at+1;i<Math.min(bars.length,at+1+maxEntry);i++){
      if(bars[i].low<=zone.high&&bars[i].high>=zone.low){entryIndex=i;entryRaw=signal.plannedEntry;break}
    }
    if(entryIndex===null)return {attempted:true,trade:null,reason:'not-filled-10d'}
    stop=exitModel==='plan'?signal.stop:buildVariableStop(signal,stopMultiplier)
    target=signal.target
  }else if(signal.group==='รอ Breakout'){
    const trigger=signal.breakoutTrigger
    if(!Number.isFinite(trigger))return {attempted:true,trade:null,reason:'missing-breakout-trigger'}
    for(let i=at+1;i<Math.min(bars.length,at+1+maxEntry);i++){
      const prior=bars.slice(Math.max(0,i-20),i)
      if(prior.length<20)continue
      const average=prior.reduce((sum,b)=>sum+b.volume,0)/prior.length
      if(bars[i].close>trigger&&average>0&&bars[i].volume>=1.2*average){entryIndex=i;entryRaw=trigger;break}
    }
    if(entryIndex===null)return {attempted:true,trade:null,reason:'not-breakout-10d'}
    const risk=1.5*signal.atr*stopMultiplier
    stop=entryRaw-risk
    target=entryRaw+2*risk
  }else return {attempted:false,trade:null,reason:'non-entry-signal'}
  if(!Number.isFinite(stop)||!Number.isFinite(target)||entryRaw<=stop||target<=stop)return {attempted:true,trade:null,reason:'invalid-risk-or-target'}
  const trade=simulateExit(signal.symbol,entryIndex,entryRaw,stop,target)
  return {attempted:true,filled:true,entryDate:bars[entryIndex].date,trade:trade?{...trade,symbol:signal.symbol,group:groupFor(signal),signalDate:signal.date,score:signal.score,
    stop,target,stopMultiplier,signalRrNow:signal.rrNow,signalRrAtEntry:signal.rrAtEntry}:null,pending:!trade,reason:trade?null:'right-censored-at-data-end'}
}

function makeEpisodes(rows){
  const sorted=[...rows].sort((a,b)=>a.date.localeCompare(b.date)||a.symbol.localeCompare(b.symbol))
  const episodes=[],latestByTickerGroup=new Map()
  for(const row of sorted){
    const group=groupFor(row),key=`${row.symbol}:${group}`,previous=latestByTickerGroup.get(key)
    if(previous&&dateDiff(previous.lastDate,row.date)<=8){previous.signals++;previous.lastDate=row.date;previous.lastSignal=row}
    else {const episode={symbol:row.symbol,group,firstDate:row.date,lastDate:row.date,firstSignal:row,signals:1};episodes.push(episode);latestByTickerGroup.set(key,episode)}
  }
  return episodes
}
function activeEpisodes(rows){
  const episodes=makeEpisodes(rows),sorted=episodes.sort((a,b)=>a.firstDate.localeCompare(b.firstDate)||a.symbol.localeCompare(b.symbol))
  const activeUntil=new Map(),kept=[],suppressed=[]
  for(const episode of sorted){
    const blockedUntil=activeUntil.get(episode.symbol)
    if(blockedUntil&&episode.firstDate<=blockedUntil){suppressed.push(episode);continue}
    kept.push(episode)
    const attempt=fillSignal(episode.firstSignal,1.5)
    if(attempt.trade)activeUntil.set(episode.symbol,attempt.trade.exitDate)
    else if(attempt.pending)activeUntil.set(episode.symbol,barsBySymbol.get(episode.symbol).at(-1).date)
  }
  return {episodes:kept,suppressed,preSuppression:episodes}
}
function median(values){if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function hashSeed(text){let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function bootstrapCI(values,label,rounds=4000){
  if(!values.length)return {ci95Low:null,ci95High:null}
  let seed=hashSeed(label)||1
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296}
  const means=[]
  for(let i=0;i<rounds;i++){let sum=0;for(let j=0;j<values.length;j++)sum+=values[Math.floor(random()*values.length)];means.push(sum/values.length)}
  means.sort((a,b)=>a-b)
  return {ci95Low:means[Math.floor((rounds-1)*.025)],ci95High:means[Math.floor((rounds-1)*.975)]}
}
function stats(group,episodes,mult=1.5,excludeEarningsWeek=false,period=null,suppressedEpisodes=[],exitModel='generic'){
  const selected=episodes.filter(e=>e.group===group)
  const attempts=selected.map(e=>({episode:e,...fillSignal(e.firstSignal,mult,exitModel)}))
  const eligible=excludeEarningsWeek?attempts.filter(a=>!a.filled||!isEarningsWeek(a.entryDate)):attempts
  const trades=eligible.filter(a=>a.trade).map(a=>a.trade)
  const fills=eligible.filter(a=>a.filled).length
  const pending=eligible.filter(a=>a.pending).length
  const rs=trades.map(t=>t.r)
  const signalCount=signals.filter(s=>groupFor(s)===group&&(!period||periodName(s.date)===period)).length
  const suppressed=suppressedEpisodes.filter(e=>e.group===group&&(!period||periodName(e.firstDate)===period)).length
  return {group,exitModel,signals:signalCount,episodes:eligible.length,suppressed:suppressed+selected.length-eligible.length,
    fills, pending, fillRate:eligible.length?fills/eligible.length:null,winRate:trades.length?trades.filter(t=>t.win).length/trades.length:null,
    avgR:rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:null,medianR:median(rs),expectancy:rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:null,
    worstR:rs.length?Math.min(...rs):null,...bootstrapCI(rs,`${group}:${period??'all'}:${exitModel}:${mult}`),
    sampleStatus:eligible.length<30?'ตัวอย่างไม่พอสรุป':'จำนวน episode ถึงเกณฑ์เบื้องต้น',trades}
}
function isEarningsWeek(iso){
  const d=new Date(`${iso}T00:00:00Z`),month=d.getUTCMonth()+1,day=d.getUTCDate()
  return [1,4,7,10].includes(month)&&day>=22&&day<=28
}
function periodName(date){
  const d=new Date(`${date}T00:00:00Z`),boundary=new Date('2024-10-29T00:00:00Z')
  return d<boundary?'in-sample':'out-of-sample'
}
const allGroups=[...new Set(signals.map(groupFor))]
const active=activeEpisodes(signals)
const primary=[]
const planMetrics=[]
for(const group of allGroups){
  primary.push(stats(group,active.episodes,1.5,false,null,active.suppressed))
  planMetrics.push(stats(group,active.episodes,1.5,false,null,active.suppressed,'plan'))
  for(const period of ['in-sample','out-of-sample']){
    const periodEpisodes=active.episodes.filter(e=>e.group===group&&periodName(e.firstDate)===period)
    const periodSuppressed=active.suppressed.filter(e=>periodName(e.firstDate)===period)
    primary.push({...stats(group,periodEpisodes,1.5,false,period,periodSuppressed),period})
    planMetrics.push({...stats(group,periodEpisodes,1.5,false,period,periodSuppressed,'plan'),period})
  }
}
const tradeRows=primary.filter(row=>row.trades).flatMap(row=>row.trades)
const uniqueTradeMap=new Map(tradeRows.map(t=>[`${t.signalDate}:${t.symbol}:${t.group}:${t.stopMultiplier}`,t]))
const allTrades=[...uniqueTradeMap.values()]

// Earnings-week exclusion applies to the signal/entry episode date and is explicitly approximate.
const earningsFiltered=[]
for(const group of allGroups)earningsFiltered.push(stats(group,active.episodes,1.5,true,null,active.suppressed))

// Stop sensitivity reuses the same frozen library decisions and changes only the realized stop distance.
const sensitivity=[]
for(const mult of multipliers)for(const group of allGroups){
  const row=stats(group,active.episodes,mult,false,null,active.suppressed)
  sensitivity.push({multiplier:mult,...row})
}

function randomTrade(symbol,date,atr){
  const entryIndex=nextIndex(symbol,date)
  const bars=barsBySymbol.get(symbol)
  if(entryIndex===null||!bars[entryIndex]||bars[entryIndex].open==null||!Number.isFinite(atr)||atr<=0)return null
  const entry=bars[entryIndex].open,stop=entry-1.5*atr,target=entry+2*(entry-stop)
  const exited=simulateExit(symbol,entryIndex,entry,stop,target)
  return exited?{...exited,symbol,signalDate:date}:null
}
const baseline=[]
for(const targetGroup of ['รอย่อ','ซื้อได้ตอนนี้','ซื้อไม้แรก · R:R NOW <1.5','ซื้อไม้แรก · R:R NOW >=1.5']){
  const rows=active.episodes.filter(e=>e.group===targetGroup)
  const trials=[]
  for(let round=0;round<200;round++){
    let seed=(round+1)*2654435761>>>0
    const next=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296}
    const returns=[],randomActiveUntil=new Map()
    for(const episode of rows){
      const sourceDate=episode.firstSignal.technicalDate?.slice(0,10)??episode.firstDate
      const eligible=symbols.filter(symbol=>{
        const snap=marketByDateTicker.get(`${episode.firstDate}:${symbol}`)
        return snap&&Number.isFinite(snap.atr)&&snap.atr>0&&nextIndex(symbol,sourceDate)!==null&&
          (!randomActiveUntil.has(symbol)||sourceDate>randomActiveUntil.get(symbol))
      })
      if(!eligible.length)continue
      const ticker=eligible[Math.floor(next()*eligible.length)]
      const snap=marketByDateTicker.get(`${episode.firstDate}:${ticker}`)
      const trade=randomTrade(ticker,sourceDate,snap.atr)
      if(trade){returns.push(trade.r);randomActiveUntil.set(ticker,trade.exitDate)}
    }
    trials.push(returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:null)
  }
  const valid=trials.filter(Number.isFinite).sort((a,b)=>a-b)
  baseline.push({group:targetGroup,matchedEpisodes:rows.length,rounds:200,meanExpectancy:valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null,
    p05:valid.length?valid[Math.floor((valid.length-1)*.05)]:null,p95:valid.length?valid[Math.floor((valid.length-1)*.95)]:null,
    ...bootstrapCI(valid,`random:${targetGroup}`),validRounds:valid.length})
}
function matchedSpyReturn(trade){
  const spy=barsBySymbol.get('SPY'),entryIndex=indices.get('SPY')?.get(trade.entryDate),exitIndex=indices.get('SPY')?.get(trade.exitDate)
  if(entryIndex===undefined||exitIndex===undefined||!Number.isFinite(spy[entryIndex]?.open)||!Number.isFinite(spy[exitIndex]?.close))return null
  return (spy[exitIndex].close*(1-slippage)-spy[entryIndex].open*(1+slippage))/spy[entryIndex].open
}
const spyBaseline=[]
for(const mode of ['generic','plan'])for(const targetGroup of ['รอย่อ','ซื้อได้ตอนนี้','ซื้อไม้แรก · R:R NOW <1.5','ซื้อไม้แรก · R:R NOW >=1.5']){
  const episodes=active.episodes.filter(e=>e.group===targetGroup)
  const returns=[]
  for(const episode of episodes){const attempt=fillSignal(episode.firstSignal,1.5,mode);if(attempt.trade){const value=matchedSpyReturn(attempt.trade);if(value!==null)returns.push(value)}}
  spyBaseline.push({mode,group:targetGroup,n:returns.length,avgMatchedReturn:returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:null,medianMatchedReturn:median(returns),...bootstrapCI(returns,`spy:${mode}:${targetGroup}`)})
}

function csv(rows,columns){
  const escape=value=>{if(value===null||value===undefined)return '';const text=typeof value==='object'?JSON.stringify(value):String(value);return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text}
  return [columns.join(','),...rows.map(row=>columns.map(key=>escape(row[key])).join(','))].join('\r\n')+'\r\n'
}
await fs.mkdir(resultDir,{recursive:true})
await fs.writeFile(path.join(resultDir,'trades.csv'),csv(allTrades,['symbol','group','signalDate','entryDate','exitDate','entryRaw','exitPrice','stop','target','reason','r','win','stopMultiplier','signalRrNow','signalRrAtEntry']))
const planTradeRows=planMetrics.filter(row=>row.period===undefined).flatMap(row=>row.trades)
await fs.writeFile(path.join(resultDir,'plan-exit-trades.csv'),csv(planTradeRows,['symbol','group','signalDate','entryDate','exitDate','entryRaw','exitPrice','stop','target','reason','r','win','stopMultiplier','signalRrNow','signalRrAtEntry']))
const selectionDiagnostics=JSON.parse(await fs.readFile(path.join(resultDir,'selection-diagnostics.json'),'utf8'))
selectionDiagnostics.signalToEpisodeByLabel=Object.fromEntries(allGroups.map(group=>[group,{validatedSignals:signals.filter(s=>groupFor(s)===group).length,
  episodesBeforeActiveTradeSuppression:active.preSuppression.filter(e=>e.group===group).length,suppressedDuringOpenTrade:active.suppressed.filter(e=>e.group===group).length,
  eligibleEpisodes:active.episodes.filter(e=>e.group===group).length}]))
await fs.writeFile(path.join(resultDir,'selection-diagnostics.json'),JSON.stringify(selectionDiagnostics,null,2))
await fs.writeFile(path.join(resultDir,'summary.json'),JSON.stringify({signalsByGroup:Object.fromEntries(allGroups.map(group=>[group,signals.filter(s=>groupFor(s)===group).length])),
  metrics:primary.map(({trades,...rest})=>rest),baseline,spyBaseline,earningsWeekExclusion:earningsFiltered.map(({trades,...rest})=>rest),
  planExitMetrics:planMetrics.map(({trades,...rest})=>rest),
  stopSensitivity:sensitivity.map(({trades,...rest})=>rest),periodBoundary:'2024-10-29',earningsWeekRule:'Approximation: actual entry date day 22 through 28 of Jan/Apr/Jul/Oct',
  sampleCaveats:'<30 episodes is too small to conclude; historical earnings are unavailable and all signals were scored with earningsStatus=none.',
  modelingCaveats:['Decisions and scores are the actual exported library functions; classifySetup is invoked inside scoreScannerCandidate but not exported.',
    'The production API route private riskReward calculation is not imported; selectPreliminary candidate rank uses buildStockCheck riskRewardAtEntry as the pure library source.',
    'Yahoo weekly candles are aggregated from daily cache by ISO calendar week.',
    'Generic mode preserves the previous simulator: recalculates the library Stop helper at the selected ATR multiplier, keeps buildStockCheck Target 1; plan mode uses exact signal-time buildStockCheck Stop and Target 1. Breakout has no buildStockCheck entry plan, so both modes use trigger entry, 1.5 ATR Stop and 2R Target.',
    'Plan-vs-generic comparisons reuse the same episodes and suppression set to isolate exit-plan effect.',
    'ATR sensitivity changes stop distance during trade simulation only; signal membership/decision stays fixed at default app logic.',
    'Repeated same ticker/group signals within an episode are consolidated; subsequent same-ticker episodes during open trades are suppressed.']},null,2))
const summaryColumns=['group','period','exitModel','signals','episodes','suppressed','fills','pending','fillRate','winRate','avgR','medianR','expectancy','ci95Low','ci95High','worstR','sampleStatus']
await fs.writeFile(path.join(resultDir,'summary.csv'),csv(primary.map(({trades,...rest})=>rest),summaryColumns))
await fs.writeFile(path.join(resultDir,'plan-exit-summary.csv'),csv(planMetrics.map(({trades,...rest})=>rest),summaryColumns))
await fs.writeFile(path.join(resultDir,'exit-mode-comparison.csv'),csv([...primary,...planMetrics].map(({trades,...rest})=>rest),summaryColumns))
await fs.writeFile(path.join(resultDir,'baselines.csv'),csv(baseline,['group','matchedEpisodes','rounds','meanExpectancy','p05','p95','ci95Low','ci95High','validRounds']))
await fs.writeFile(path.join(resultDir,'spy-baseline.csv'),csv(spyBaseline,['mode','group','n','avgMatchedReturn','medianMatchedReturn','ci95Low','ci95High']))
await fs.writeFile(path.join(resultDir,'stop-sensitivity.csv'),csv(sensitivity,['multiplier','group','signals','episodes','suppressed','fills','pending','fillRate','winRate','avgR','medianR','expectancy','ci95Low','ci95High','worstR','sampleStatus']))
await fs.writeFile(path.join(resultDir,'earnings-week-exclusion.csv'),csv(earningsFiltered.map(({trades,...rest})=>rest),['group','signals','episodes','suppressed','fills','fillRate','winRate','avgR','medianR','expectancy','ci95Low','ci95High','worstR']))
console.log(JSON.stringify({signals:signals.length,episodes:active.episodes.length,suppressedDuringHold:active.suppressed.length,trades:allTrades.length,groups:allGroups.length,out:resultDir}))
