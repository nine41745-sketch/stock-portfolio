import fs from 'node:fs/promises'
import path from 'node:path'
import { SNAPSHOT_DIR } from './paths.mjs'
import ts from 'typescript'
import YahooFinance from 'yahoo-finance2'

const OUTPUT = process.argv[2] ?? SNAPSHOT_DIR

async function importTsModule(filePath) {
  const source = await fs.readFile(filePath, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 }, fileName: filePath })
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
}

const { SCANNER_UNIVERSES, dedupeScannerSymbols } = await importTsModule('lib/stock-scanner.ts')
const symbols = [...dedupeScannerSymbols(Object.values(SCANNER_UNIVERSES)), 'SPY']
const client = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
const end = new Date()
const start = new Date(end)
start.setFullYear(start.getFullYear() - 6)
await fs.mkdir(OUTPUT, { recursive: true })
const manifest = { requestedAt: new Date().toISOString(), start: start.toISOString(), end: end.toISOString(), symbols, results: {} }

async function getYahoo(symbol) {
  const result = await client.chart(symbol, { period1: start, period2: end, interval: '1d' })
  return (result.quotes ?? []).filter(q => [q.close,q.high,q.low,q.volume].every(v => typeof v === 'number' && Number.isFinite(v)))
    .map(q => ({ date: q.date instanceof Date ? q.date.toISOString().slice(0,10) : String(q.date).slice(0,10), open: q.open ?? null, high:q.high,low:q.low,close:q.close,volume:q.volume }))
}

async function getStooq(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=d`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Stooq HTTP ${response.status}`)
  const lines = (await response.text()).trim().split(/\r?\n/).slice(1)
  return lines.map(line => { const [date,open,high,low,close,volume] = line.split(',').map((v,i) => i===0?v:Number(v)); return {date,open,high,low,close,volume} })
    .filter(row => [row.high,row.low,row.close,row.volume].every(Number.isFinite))
}

for (let i=0; i<symbols.length; i+=2) {
  const pair = symbols.slice(i,i+2)
  const outcomes = await Promise.all(pair.map(async symbol => {
    try {
      const yahoo = await getYahoo(symbol)
      let bars=yahoo,source='Yahoo Finance',fallback=null
      if(yahoo.length<200){
        try { const stooq=await getStooq(symbol); if(stooq.length>yahoo.length){bars=stooq;source='Stooq'} fallback={yahooBars:yahoo.length,stooqBars:stooq.length} }
        catch(error){fallback={yahooBars:yahoo.length,stooqError:String(error)}}
      }
      const item={symbol,source,barsCount:bars.length,firstDate:bars[0]?.date??null,lastDate:bars.at(-1)?.date??null,fallback,bars}
      await fs.writeFile(path.join(OUTPUT,`${symbol}.json`),JSON.stringify(item))
      return [symbol,{source,barsCount:bars.length,firstDate:item.firstDate,lastDate:item.lastDate,fallback}]
    }catch(error){return [symbol,{error:String(error)}]}
  }))
  for(const [symbol,result] of outcomes) manifest.results[symbol]=result
  process.stdout.write(`${pair.join(',')}: ${outcomes.map(([s,r])=>`${s}=${r.barsCount??'ERROR'}`).join(' ')}\n`)
  if(i+2<symbols.length) await new Promise(resolve=>setTimeout(resolve,1200))
}
await fs.writeFile(path.join(OUTPUT,'manifest.json'),JSON.stringify(manifest,null,2))
process.stdout.write(`Saved ${symbols.length} symbols to ${OUTPUT}\n`)
