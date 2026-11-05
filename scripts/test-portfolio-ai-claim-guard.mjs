import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

function transpile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${filePath} transpile diagnostics: ${errors.map(e => e.messageText).join('; ')}`)
  return compiled.outputText
}

const toDataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

// The guard imports the Stock Check guard through the '@/lib' alias; point that specifier at an inlined copy.
const claimGuardUrl = toDataUrl(transpile('lib/stock-check-ai-guard.ts'))
const portfolioGuardCode = transpile('lib/portfolio-ai-claim-guard.ts').replace("'@/lib/stock-check-ai-guard'", `'${claimGuardUrl}'`)
assert.ok(portfolioGuardCode.includes(claimGuardUrl), 'The alias import must be rewritten for the test loader')
const guard = await import(toDataUrl(portfolioGuardCode))

function makeResult(overrides = {}) {
  const base = {
    symbol: 'TEST',
    disclaimer: 'x',
    technicalSummary: 'แนวโน้มระยะกลางยังเป็นขาขึ้น',
    newsImpact: [],
    risksAndOpportunities: { caution: '', opportunity: '' },
    recommendation: { action: 'HOLD', buyConditions: '', sellConditions: '' },
    risks: [],
    summary: 'ถือต่อ',
    analysedAt: '2026-11-05T01:00:00.000Z',
    technical: {
      ema50: 100, ema100: 98, ema200: 90, rsi14: 55, weeklyRsi14: 55,
      macd: { macd: 1, signal: 1, histogram: 0 }, bollinger: { upper: 110, middle: 100, lower: 90 },
      trend: 'UPTREND', lastClose: 105, support: 1.59, resistance: 2.4, volumeRatio: 1,
    },
    usedPrice: 1.87,
    usedNews: [],
    earnings: null,
  }
  return { ...base, ...overrides }
}
const withText = (fields, extra = {}) => makeResult({ ...fields, ...extra })

// ---------- must cut ----------

// EOSE: "at support" while the price is 17.6% above technical.support.
{
  const r = withText({ summary: 'ราคาอยู่ที่แนวรับ 1.59 ดอลลาร์. ปริมาณซื้อขายยังเบาบาง' })
  const out = guard.guardPortfolioAnalysisText(r)
  assert.equal(out.removed, 1)
  assert.ok(!out.result.summary.includes('แนวรับ'), 'The false support claim must be removed')
  assert.ok(out.result.summary.includes('ปริมาณซื้อขายยังเบาบาง'), 'The neighbouring sentence must stay')
  assert.equal(guard.findPortfolioClaimViolation('ราคาทดสอบแนวรับอีกครั้ง', {
    facts: { price: 1.87, ema50: null, ema200: null, week52High: null, week52Low: null, earningsFound: false }, support: 1.59, earningsNear: false, action: 'HOLD',
  }), 'price-near-support')
}

// RKLB: earnings in 5 days but the text says it is not near; the system adds its own warning.
{
  const r = withText(
    { risksAndOpportunities: { caution: 'ประกาศผลยังไม่ใกล้ ความเสี่ยงหลักคือความผันผวน', opportunity: '' } },
    { earnings: { date: '2026-11-09', daysUntil: 5, hour: 'amc' } },
  )
  const out = guard.guardPortfolioAnalysisText(r)
  assert.equal(out.removed, 1)
  assert.equal(out.noticeAdded, true)
  assert.ok(out.result.risksAndOpportunities.caution.startsWith('ระบบเตือน: ประกาศงบในอีก 5 วัน (2026-11-09, amc)'))
  assert.ok(out.result.risksAndOpportunities.caution.includes('ความเสี่ยงหลักคือความผันผวน'))
  assert.ok(!out.result.risksAndOpportunities.caution.includes('ยังไม่ใกล้'))
}

// NVO: earnings today and the text never mentions it.
{
  const r = withText({ summary: 'แนวโน้มยังดี ถือต่อ' }, { earnings: { date: '2026-11-04', daysUntil: 0, hour: null } })
  const out = guard.guardPortfolioAnalysisText(r)
  assert.equal(out.removed, 0)
  assert.equal(out.noticeAdded, true)
  assert.ok(out.result.risksAndOpportunities.caution.includes('ประกาศงบวันนี้ (2026-11-04)'))
}

// WDC: the execution guard forced HOLD but the model text still advocates adding.
{
  const note = 'Scale-in Guard: ยังไม่มี new trigger ที่ผ่านเงื่อนไข จึงไม่เพิ่มไม้'
  const r = withText(
    { summary: `${note}\nหุ้นเหมาะกับการเพิ่มสถานะในจังหวะนี้. แนวโน้มระยะกลางยังดี` },
    { recommendation: { action: 'HOLD', buyConditions: note, sellConditions: '' } },
  )
  const out = guard.guardPortfolioAnalysisText(r)
  assert.equal(out.removed, 1)
  assert.ok(out.result.summary.startsWith(note), 'The system guard note must be kept')
  assert.ok(!out.result.summary.includes('เหมาะกับการเพิ่มสถานะ'))
  assert.ok(out.result.summary.includes('แนวโน้มระยะกลางยังดี'))
  assert.equal(out.result.recommendation.buyConditions, note, 'Conditions are never edited')
}

// BUY action with text that tells the user to sell.
{
  const r = withText({ summary: 'ควรขายทำกำไรทั้งหมดทันที. พื้นฐานยังแข็งแรง' }, { recommendation: { action: 'BUY', buyConditions: '', sellConditions: '' } })
  const out = guard.guardPortfolioAnalysisText(r)
  assert.equal(out.removed, 1)
  assert.ok(!out.result.summary.includes('ควรขาย'))
}

// EMA claim reused from the Stock Check guard: price 1.87 is below EMA50 100.
{
  const r = withText({ summary: 'ราคาอยู่เหนือ EMA50 อย่างชัดเจน. สภาพคล่องปกติ' })
  const out = guard.guardPortfolioAnalysisText(r)
  assert.equal(out.removed, 1)
  assert.ok(out.result.summary.includes('สภาพคล่องปกติ'))
}

// Thai text without punctuation: only the violating clause goes, the other clauses stay.
{
  const out = guard.guardPortfolioAnalysisText(withText({ summary: 'พื้นฐานดี ราคาอยู่ที่แนวรับ ปริมาณเบาบาง' }))
  assert.equal(out.removed, 1)
  assert.equal(out.result.summary, 'พื้นฐานดี ปริมาณเบาบาง')
}

// Lists lose only the violating item; an emptied summary / technicalSummary gets a non-empty replacement.
{
  const r = withText({
    summary: 'ราคาอยู่ที่แนวรับ',
    technicalSummary: 'ราคาทดสอบแนวรับ',
    risks: ['ความผันผวนสูง', 'ราคาอยู่ที่แนวรับ'],
  })
  const out = guard.guardPortfolioAnalysisText(r)
  assert.equal(out.removed, 3)
  assert.deepEqual(out.result.risks, ['ความผันผวนสูง'])
  assert.ok(out.result.summary.length > 0 && out.result.summary.includes('HOLD'))
  assert.ok(out.result.technicalSummary.length > 0, 'technicalSummary must never be left empty (the UI hides the technical block)')
}

// ---------- must NOT cut ----------

{
  const unchanged = (fields, extra = {}) => {
    const r = withText(fields, extra)
    const out = guard.guardPortfolioAnalysisText(r)
    assert.equal(out.removed, 0, `unexpected removal for ${JSON.stringify(fields)}`)
    assert.equal(out.noticeAdded, false, `unexpected notice for ${JSON.stringify(fields)}`)
    assert.equal(out.result, r, 'The same object must be returned when nothing changes')
  }
  // Price within 5% of support.
  unchanged({ summary: 'ราคาอยู่ที่แนวรับ' }, { usedPrice: 1.62 })
  // Negated and "above support" wording while far from support.
  unchanged({ summary: 'ราคายังไม่ใกล้แนวรับ' })
  unchanged({ summary: 'ราคายืนเหนือแนวรับ 1.59 ได้' })
  unchanged({ summary: 'ราคาห่างจากแนวรับพอสมควร' })
  // Buy wording that is negated or conditional is not a contradiction with HOLD.
  unchanged({ summary: 'ไม่ควรเพิ่มสถานะในตอนนี้' })
  unchanged({ summary: 'ควรเพิ่มเมื่อราคายืนเหนือแนวต้านได้' })
  // BUY action with buy wording; HOLD with sell conditions in the conditions fields only.
  unchanged({ summary: 'เหมาะกับการเพิ่มสถานะ' }, { recommendation: { action: 'BUY', buyConditions: '', sellConditions: '' } })
  unchanged({ recommendation: { action: 'HOLD', buyConditions: 'ควรเพิ่มเมื่อยืนเหนือ 2.4', sellConditions: 'ควรขายถ้าหลุด 1.5' } })
  // Earnings: far away, or near and already mentioned, or unknown.
  unchanged({ risksAndOpportunities: { caution: 'ประกาศผลยังไม่ใกล้', opportunity: '' } }, { earnings: { date: '2026-11-17', daysUntil: 12, hour: null } })
  unchanged({ summary: 'ประกาศงบในอีก 3 วัน ระวังความผันผวน' }, { earnings: { date: '2026-11-08', daysUntil: 3, hour: null } })
  unchanged({ summary: 'ไม่มีข้อมูลเพิ่มเติม' }, { earnings: null })
  // System notes are never touched even when they contain trigger words.
  unchanged({ summary: 'Execution Guard: เพิ่งขายผ่าน Auto Sync จึงพัก SELL_PARTIAL ควรเพิ่มเมื่อมี trigger ใหม่' })
  // Error results and results without technicals pass through.
  const errored = makeResult({ error: 'FAILED', summary: 'ราคาอยู่ที่แนวรับ' })
  assert.equal(guard.guardPortfolioAnalysisText(errored).result, errored)
  const noTechnical = makeResult({ technical: undefined })
  assert.equal(guard.guardPortfolioAnalysisText(noTechnical).result, noTechnical)
}

// Idempotent: a second pass over guarded output changes nothing.
{
  const r = withText(
    { summary: 'ราคาอยู่ที่แนวรับ. ถือต่อ', risksAndOpportunities: { caution: 'ประกาศผลยังไม่ใกล้', opportunity: '' } },
    { earnings: { date: '2026-11-09', daysUntil: 5, hour: null } },
  )
  const once = guard.guardPortfolioAnalysisText(r).result
  const twice = guard.guardPortfolioAnalysisText(once)
  assert.equal(twice.removed, 0)
  assert.equal(twice.noticeAdded, false)
  assert.equal(twice.result, once)
}

// The wrapper logs counts only, never text.
{
  const logged = []
  const original = console.warn
  console.warn = (...args) => logged.push(args.join(' '))
  try {
    guard.applyPortfolioAiClaimGuard(withText({ summary: 'ราคาอยู่ที่แนวรับลับเฉพาะ' }))
  } finally {
    console.warn = original
  }
  assert.equal(logged.length, 1)
  assert.match(logged[0], /\[portfolio-ai-guard\] TEST: removed 1 claim\(s\)/)
  assert.ok(!logged[0].includes('ลับเฉพาะ'), 'Log lines must not contain analysis text')
}

// ---------- wiring ----------

const analyzeRoute = fs.readFileSync('app/api/analyze/route.ts', 'utf8')
const guardCalls = analyzeRoute.match(/applyPortfolioAiClaimGuard\(applyRecentTradeExecutionGuard\(/g) ?? []
assert.equal(guardCalls.length, 2, '/api/analyze must guard both the cached and the fresh result')
assert.ok(
  analyzeRoute.indexOf('const guardedCached = applyPortfolioAiClaimGuard') < analyzeRoute.indexOf('await saveManualLatest(guardedCached)'),
  'The cached result must be guarded before it is persisted',
)
assert.ok(
  analyzeRoute.indexOf('const result = applyPortfolioAiClaimGuard') < analyzeRoute.indexOf('await saveManualLatest(result)'),
  'The fresh result must be guarded before it is persisted',
)
assert.match(analyzeRoute, /cacheSet\(cacheKey, rawResult,/, 'The cache must keep the raw AI output')

for (const path of ['app/api/cron/daily-analyze/route.ts', 'app/api/cron/premarket-analyze/route.ts']) {
  const source = fs.readFileSync(path, 'utf8')
  assert.match(source, /const executionGuarded = applyRecentTradeExecutionGuard\(/, `${path} must run the execution guard first`)
  assert.match(source, /const result = applyPortfolioAiClaimGuard\(executionGuarded\)/, `${path} must run the claim guard after it`)
  assert.ok(
    source.indexOf('applyPortfolioAiClaimGuard(executionGuarded)') < source.indexOf('save_latest_manual_analysis') ||
      source.indexOf('applyPortfolioAiClaimGuard(executionGuarded)') < source.indexOf('const row = {'),
    `${path} must guard before the result is stored`,
  )
}

console.log('✓ Portfolio AI claim guard drops contradicting sentences, adds a missing earnings warning, keeps system notes and never edits conditions')
