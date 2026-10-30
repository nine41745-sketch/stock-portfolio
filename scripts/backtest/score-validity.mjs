import fs from 'node:fs/promises'
import path from 'node:path'
import { SNAPSHOT_DIR, RESULTS_DIR } from './paths.mjs'

const snapshotDir=process.argv[2]??SNAPSHOT_DIR,resultDir=process.argv[3]??RESULTS_DIR
const rows=JSON.parse(await fs.readFile(path.join(resultDir,'universe-scores.json'),'utf8'))
const validatedSignals=JSON.parse(await fs.readFile(path.join(resultDir,'signals.json'),'utf8'))
const manifest=JSON.parse(await fs.readFile(path.join(snapshotDir,'manifest.json'),'utf8'))
const barsBySymbol=new Map()
for(const symbol of manifest.symbols)barsBySymbol.set(symbol,JSON.parse(await fs.readFile(path.join(snapshotDir,`${symbol}.json`),'utf8')).bars)
const indexBySymbol=new Map([...barsBySymbol].map(([symbol,bars])=>[symbol,new Map(bars.map((bar,index)=>[bar.date,index]))]))
const boundary='2024-10-29'
const buckets=[['<45',-Infinity,45],['45-57',45,58],['58-67',58,68],['68-71',68,72],['72+',72,Infinity]]
const metrics=['score','trendScore','momentum','volume','priceLocation','relativeStrength','riskCatalyst']
const enriched=[]
for(const row of rows){
  const bars=barsBySymbol.get(row.symbol),idx=indexBySymbol.get(row.symbol)?.get(row.technicalDate)
  const entryIndex=idx===undefined?null:idx+1,entry=entryIndex===null?null:bars[entryIndex]?.open
  const returns={}
  for(const horizon of [5,10,20]){
    const exit=entryIndex===null?null:bars[entryIndex+horizon-1]?.close
    returns[`forward${horizon}d`]=Number.isFinite(entry)&&Number.isFinite(exit)?exit/entry-1:null
  }
  enriched.push({...row,period:row.date<boundary?'in-sample':'out-of-sample',...returns})
}
const byDate=new Map()
for(const row of enriched){if(!byDate.has(row.date))byDate.set(row.date,[]);byDate.get(row.date).push(row)}
const cohorts=new Map([['all',()=>true],...['UPTREND','SIDEWAYS','DOWNTREND'].map(trend=>[`trend:${trend}`,r=>r.trend===trend]),
  ['period:in-sample',r=>r.period==='in-sample'],['period:out-of-sample',r=>r.period==='out-of-sample'],
  ...['UPTREND','SIDEWAYS','DOWNTREND'].flatMap(trend=>['in-sample','out-of-sample'].map(period=>[`trend-period:${trend}:${period}`,r=>r.trend===trend&&r.period===period]))])
const bucketRows=[]
for(const [cohort,predicate] of cohorts){
  for(const horizon of [5,10,20]){
    for(const [bucket,low,high] of buckets){
      const observations=[]
      for(const dateRows of byDate.values()){
        const available=dateRows.filter(r=>Number.isFinite(r[`forward${horizon}d`]))
        const universeMean=available.length?available.reduce((s,r)=>s+r[`forward${horizon}d`],0)/available.length:null
        for(const r of available){if(!Number.isFinite(r.score)||!predicate(r)||r.score<low||r.score>=high)continue;observations.push({value:r[`forward${horizon}d`],excess:r[`forward${horizon}d`]-universeMean})}
      }
      const sorted=xs=>xs.sort((a,b)=>a-b)
      const median=xs=>{if(!xs.length)return null;const a=sorted([...xs]),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
      const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null
      bucketRows.push({cohort,horizon,bucket,n:observations.length,meanReturn:avg(observations.map(o=>o.value)),medianReturn:median(observations.map(o=>o.value)),meanExcess:avg(observations.map(o=>o.excess)),medianExcess:median(observations.map(o=>o.excess))})
    }
  }
}
function rank(values){
  const sorted=values.map((value,index)=>({value,index})).sort((a,b)=>a.value-b.value),ranks=Array(values.length)
  for(let i=0;i<sorted.length;){let j=i+1;while(j<sorted.length&&sorted[j].value===sorted[i].value)j++;const average=(i+1+j)/2;for(let k=i;k<j;k++)ranks[sorted[k].index]=average;i=j}
  return ranks
}
function pearson(a,b){const ma=a.reduce((x,y)=>x+y,0)/a.length,mb=b.reduce((x,y)=>x+y,0)/b.length;let num=0,da=0,db=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;num+=x*y;da+=x*x;db+=y*y}return da&&db?num/Math.sqrt(da*db):null}
function spearman(xs,ys){return xs.length<3?null:pearson(rank(xs),rank(ys))}
const icRows=[]
for(const [cohort,predicate] of cohorts){
  const dailyByMetric=new Map(metrics.map(metric=>[metric,[]]))
  for(const [date,dateRows] of byDate){
    const sample=dateRows.filter(r=>predicate(r)&&Number.isFinite(r.forward20d))
    if(sample.length<3)continue
    for(const metric of metrics){
      const scoreKey=metric==='trendScore'?'trend':metric
      const usable=sample.filter(r=>Number.isFinite(metric==='score'?r.score:r.categoryScores?.[scoreKey]))
      const values=usable.map(r=>metric==='score'?r.score:r.categoryScores[scoreKey])
      const ic=spearman(values,usable.map(r=>r.forward20d))
      if(ic!==null)dailyByMetric.get(metric).push({date,ic,n:usable.length})
    }
  }
  for(const [metric,days] of dailyByMetric){
    const vals=days.map(d=>d.ic),mean=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null
    const variance=vals.length>1?vals.reduce((s,x)=>s+(x-mean)**2,0)/(vals.length-1):null
    icRows.push({cohort,metric,days:vals.length,meanIC:mean,tStat:variance&&variance>0?mean/Math.sqrt(variance/vals.length):null,meanCrossSectionN:days.length?days.reduce((s,d)=>s+d.n,0)/days.length:null})
  }
}
function csv(values){const columns=Object.keys(values[0]??{}),esc=x=>x===null||x===undefined?'':/[",\r\n]/.test(String(x))?`"${String(x).replaceAll('"','""')}"`:String(x);return [columns.join(','),...values.map(r=>columns.map(c=>esc(r[c])).join(','))].join('\r\n')+'\r\n'}
await fs.mkdir(resultDir,{recursive:true})
await fs.writeFile(path.join(resultDir,'score-validity.csv'),csv(bucketRows))
await fs.writeFile(path.join(resultDir,'information-coefficient.csv'),csv(icRows))
const forwardRows=enriched.map(r=>({date:r.date,symbol:r.symbol,price:r.price,score:r.score,score_trend:r.categoryScores?.trend,
  score_momentum:r.categoryScores?.momentum,score_volume:r.categoryScores?.volume,score_priceLocation:r.categoryScores?.priceLocation,
  score_relativeStrength:r.categoryScores?.relativeStrength,score_riskCatalyst:r.categoryScores?.riskCatalyst,trend:r.trend,
  setup:r.setup,decision:r.decision,group:r.group,...Object.fromEntries([5,10,20].map(h=>[`forward${h}d`,r[`forward${h}d`]]))}))
await fs.writeFile(path.join(resultDir,'universe-forward-returns.csv'),csv(forwardRows))
await fs.writeFile(path.join(resultDir,'score-validity-summary.json'),JSON.stringify({baseSha:'d13f9b52f4a97fdc4c3a7957eb2489d644d46141',snapshotRequestedAt:manifest.requestedAt,rows:enriched.length,uniqueFridays:byDate.size,periodBoundary:boundary,
  forwardReturn:'open of next trading session to close of the 5th/10th/20th trading session, simple return',excess:'same Friday universe mean for the same horizon',
  ic:'daily cross-sectional Spearman of score/category and forward 20-session return; mean and naive t-stat over Fridays',limitations:['daily IC t-stat does not adjust for serial dependence in overlapping forward returns','bucket observations require the full forward horizon to exist; edge Fridays are omitted per horizon','trend is ordinally coded DOWNTREND=0, SIDEWAYS=1, UPTREND=2 for Spearman only']},null,2))
const wait=rows.filter(r=>r.decision==='WAIT_FOR_BREAKOUT'),waitSignals=validatedSignals.filter(r=>r.decision==='WAIT_FOR_BREAKOUT')
const signalCounts=Object.fromEntries([...new Set(validatedSignals.map(r=>r.group))].map(group=>[group,validatedSignals.filter(r=>r.group===group).length]))
await fs.writeFile(path.join(resultDir,'selection-diagnostics.json'),JSON.stringify({waitForBreakout:{universeDecisionPairs:wait.length,passedPreliminary:wait.filter(r=>r.preliminary).length,passedAutomaticValidation:wait.filter(r=>r.validated).length,validatedSignalsBeforeEpisodeDedup:waitSignals.length},
  validatedSignalsByLabel:signalCounts,note:'Preliminary/automatic selection counts are read from per-candidate output of the real selection functions. Episode deduplication and active-trade suppression are emitted by simulate.mjs.'},null,2))
console.log(JSON.stringify({rows:enriched.length,fridays:byDate.size,bucketRows:bucketRows.length,icRows:icRows.length,resultDir}))
