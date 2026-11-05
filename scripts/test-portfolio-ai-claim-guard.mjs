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

// ---------- independent review findings (PR #150, head 37b93636) ----------

// M1: malformed model output must never make the guard throw (the route would return 500 on every cache hit).
{
  const near = { earnings: { date: '2026-11-09', daysUntil: 5, hour: null } }
  const variants = [
    { risksAndOpportunities: { caution: 42, opportunity: { text: 'x' } } },
    { summary: 7 },
    { technicalSummary: null },
    { risks: { not: 'a list' } },
    { newsImpact: [1, null, 'ราคาอยู่ที่แนวรับ'] },
    { recommendation: undefined },
    { risksAndOpportunities: undefined },
    { risksAndOpportunities: null },
  ]
  for (const fields of variants) {
    const out = guard.guardPortfolioAnalysisText(makeResult({ ...fields, ...near }))
    assert.ok(out.result && typeof out.result === 'object', `guard must return a result for ${JSON.stringify(fields)}`)
  }
  // A non-string caution is replaced by the system notice instead of crashing.
  const out = guard.guardPortfolioAnalysisText(makeResult({ risksAndOpportunities: { caution: 42, opportunity: '' }, ...near }))
  assert.equal(out.noticeAdded, true)
  assert.ok(String(out.result.risksAndOpportunities.caution).startsWith('ระบบเตือน: ประกาศงบในอีก 5 วัน'))
  // Only the string item in a mixed list is guarded; the others are kept as they are.
  const mixed = guard.guardPortfolioAnalysisText(makeResult({ newsImpact: [1, null, 'ราคาอยู่ที่แนวรับ'] }))
  assert.deepEqual(mixed.result.newsImpact, [1, null])
  // A result without a valid action skips the action rules but keeps the numeric ones.
  const noAction = guard.guardPortfolioAnalysisText(makeResult({ recommendation: undefined, summary: 'ควรเพิ่มสถานะ. ราคาอยู่ที่แนวรับ' }))
  assert.equal(noAction.removed, 1)
  assert.ok(noAction.result.summary.includes('ควรเพิ่มสถานะ'))
}

// M2: ordinary Thai wording that is not a contradiction must survive (action HOLD).
{
  for (const summary of [
    'ควรเพิ่มความระวังเรื่องความผันผวน',
    'ควรเพิ่มการติดตามข่าว',
    'ควรเพิ่มสถานะเมื่อราคายืนเหนือ 2.4',
    'ควรเพิ่มไม้ถ้าราคาย่อลงมา',
    'ราคาไม่ได้อยู่ที่แนวรับ',
    'ยังไม่ได้ทดสอบแนวรับ',
    'ถ้าราคาลงมาใกล้แนวรับ 1.59 ค่อยพิจารณา',
  ]) {
    const r = makeResult({ summary })
    const out = guard.guardPortfolioAnalysisText(r)
    assert.equal(out.removed, 0, `false positive for: ${summary}`)
    assert.equal(out.result, r)
  }
}

// L1: a clause left over after a removal must be able to stand alone, otherwise the whole sentence goes.
{
  const out = guard.guardPortfolioAnalysisText(makeResult({ summary: 'ไม่ ควรเพิ่มสถานะ แต่ราคาอยู่ที่แนวรับ. สภาพคล่องปกติดี' }))
  assert.equal(out.result.summary, 'สภาพคล่องปกติดี')
}

// L2: a downgrade note joined with " | " keeps the note and still lets the model text be checked.
{
  const note = 'ระบบปรับคำแนะนำจาก SELL_ALL เป็น HOLD อัตโนมัติ เนื่องจาก AI ไม่ได้ให้หลักฐานเฉพาะบริษัทมากพอ'
  const out = guard.guardPortfolioAnalysisText(makeResult({ risksAndOpportunities: { caution: `${note} | ราคาอยู่ที่แนวรับ 1.59 ดอลลาร์`, opportunity: '' } }))
  assert.equal(out.removed, 1)
  assert.equal(out.result.risksAndOpportunities.caution, note)
  for (const path of ['lib/groq.ts', 'lib/portfolio-batch.ts']) {
    assert.match(fs.readFileSync(path, 'utf8'), /\[downgradeNote\.trim\(\), [^\]]+\]\.filter\(Boolean\)\.join\(' \| '\)/, `${path} must separate the downgrade note from model text with " | "`)
  }
}

// L3: "financial statements" is not a mention of the announcement date; English "not near" is caught too.
{
  const near = { earnings: { date: '2026-11-09', daysUntil: 5, hour: null } }
  const notice = guard.guardPortfolioAnalysisText(withText({ summary: 'งบการเงินแข็งแรง ถือต่อ' }, near))
  assert.equal(notice.noticeAdded, true)
  const english = guard.guardPortfolioAnalysisText(withText({ summary: 'Earnings are not near. ถือต่อ' }, near))
  assert.equal(english.removed, 1)
  assert.ok(!english.result.summary.includes('Earnings'))
}

// L4: sell wording that contradicts a HOLD is dropped too, but a conditional one is kept.
{
  const out = guard.guardPortfolioAnalysisText(makeResult({ summary: 'ควรขายทำกำไรทันที. ถือต่อ' }))
  assert.equal(out.removed, 1)
  const r = makeResult({ summary: 'ควรขายถ้าหลุดแนวรับ 1.5' })
  assert.equal(guard.guardPortfolioAnalysisText(r).result, r)
}

// ---------- independent review, round 2 (PR #150, head 11256c85) ----------

// A condition word in a NEIGHBOURING clause must not excuse an assertion (price 1.87 vs support 1.59, action HOLD).
{
  for (const summary of [
    'ราคาอยู่ที่แนวรับ ถ้ามองระยะยาวยังดี',
    'ราคาอยู่ที่แนวรับ หากมองในมุมมองพื้นฐานยังดี',
    'ถ้าตลาดดี ราคาอยู่ที่แนวรับ',
    'เมื่อเทียบกับปีก่อน ราคาอยู่ที่แนวรับแล้ว',
    'ควรเพิ่มสถานะ ถ้ามองระยะยาว',
  ]) {
    const out = guard.guardPortfolioAnalysisText(makeResult({ summary: `${summary}. สภาพคล่องปกติดี` }))
    assert.equal(out.removed, 1, `must be removed despite a neighbouring condition word: ${summary}`)
    // The false claim goes; a leftover clause that can stand alone may stay, so only the claim wording is asserted.
    assert.ok(!/แนวรับ|เพิ่มสถานะ/.test(out.result.summary), `the claim must be gone: ${out.result.summary}`)
    assert.ok(out.result.summary.includes('สภาพคล่องปกติดี'), 'the neighbouring sentence must stay')
  }
  // "เมื่อวาน" (yesterday) is not a condition word.
  const yesterday = guard.guardPortfolioAnalysisText(makeResult({ summary: 'เมื่อวานราคาอยู่ที่แนวรับ' }))
  assert.equal(yesterday.removed, 1)
  // Advice that is conditional on a clause before it stays.
  const conditional = makeResult({ summary: 'หากราคาย่อลงมา ควรทยอยซื้อ' })
  assert.equal(guard.guardPortfolioAnalysisText(conditional).result, conditional)
}

// Every alternative of the buy wording and the earnings wording has a "must cut" case.
{
  for (const summary of ['ควรทยอยซื้อในจังหวะนี้', 'ควรสะสมเพิ่ม', 'เหมาะกับการซื้อเพิ่ม', 'แนะนำให้ทยอยซื้อ', 'น่าสะสมช่วงนี้']) {
    assert.equal(guard.guardPortfolioAnalysisText(makeResult({ summary })).removed, 1, `buy wording must be cut for HOLD: ${summary}`)
  }
  const near = { earnings: { date: '2026-11-09', daysUntil: 5, hour: null } }
  for (const summary of ['Earnings are not expected soon', 'ประกาศงบยังอีกนาน']) {
    assert.equal(guard.guardPortfolioAnalysisText(withText({ summary: `${summary}. ถือต่อ` }, near)).removed, 1, `earnings denial must be cut: ${summary}`)
  }
  // "งบไตรมาส" counts as a mention of the announcement, so no notice is added.
  const mentioned = guard.guardPortfolioAnalysisText(withText({ summary: 'งบไตรมาสหน้าต้องจับตา' }, near))
  assert.equal(mentioned.noticeAdded, false)
}

// System notes are exempt even when they contain wording the guard would cut in model text.
{
  const note = 'Scale-in Guard: ยังไม่มี trigger ใหม่ ควรเพิ่มสถานะ และราคาอยู่ที่แนวรับ'
  const r = makeResult({ summary: note })
  assert.equal(guard.guardPortfolioAnalysisText(r).result, r, 'a system note must never be cut')
  assert.equal(guard.guardPortfolioAnalysisText(makeResult({ summary: note.replace('Scale-in Guard', 'ข้อความ') })).removed, 1, 'the same text without the system prefix is cut')
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
