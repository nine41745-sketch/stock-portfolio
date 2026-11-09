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

// ---------- wording gaps seen in the Production run of 2026-11-05 (v1.41.27) ----------
// The sentences below are copied from the saved analyses shown on the Production dashboard that day.

const baseTechnical = makeResult().technical

// RKLB (HOLD, price $52.37, support $49.25, earnings in 4 days).
{
  const guardNote = 'Scale-in Guard: ไม่มี New Trigger — ราคา/เทคนิคัลยังไม่เปลี่ยนมากพอจากไม้ล่าสุด (เกณฑ์ movement ขั้นต่ำ 5.8%) และยังไม่ถึง prior support หรือ breakout/momentum confirmation ใหม่; เวลาเพียงอย่างเดียวไม่ปลดล็อก BUY ซ้ำ'
  const kept1 = 'พื้นฐานของ Rocket Lab ยังแข็งแรงโดยไม่มีสัญญาณเสียหายเชิงโครงสร้างหรือปัญหากฎระเบียบ, แม้ข่าวระบุว่ามูลค่าอาจสูงกว่าความเป็นธรรมหลังข้อตกลงกับ Iridium แต่ยังไม่ถึงขั้นทำลาย thesis.'
  const kept2 = 'การประเมินมูลค่ามีความเชื่อมั่นต่ำเนื่องจากข้อมูล P/E ไม่ครบ.'
  const kept3 = 'พอร์ตมีการกระจายที่ดีแต่ตำแหน่ง RKLB มีสัดส่วน 20% ซึ่งค่อนข้างสูง; เงินสดสำรองจำกัด (4.6%).'
  const contradicting = 'เนื่องจาก RSI ต่ำ (<45) แสดงโอกาสสะสมและราคายังอยู่เหนือระดับสนับสนุน, การซื้อเพิ่มในขนาดเล็กจึงเหมาะสมพร้อมระมัดระวังความผันผวนจากผลประกอบการที่ใกล้เข้ามา'
  const rklb = fields => makeResult({
    technical: { ...baseTechnical, support: 49.25, ema50: 63.34, ema200: 72.37 },
    usedPrice: 52.37,
    earnings: { date: '2026-11-09', daysUntil: 4, hour: 'amc' },
    ...fields,
  })

  // HOLD but the model says a small add is suitable: that sentence goes, the guard note and the other sentences stay.
  const summary = guard.guardPortfolioAnalysisText(rklb({ summary: `${guardNote}\n${kept1} ${kept2} ${kept3} ${contradicting}` }))
  assert.equal(summary.removed, 1)
  assert.ok(summary.result.summary.startsWith(guardNote), 'The system guard note must stay')
  for (const text of [kept1, kept2, kept3]) assert.ok(summary.result.summary.includes(text.replace(/\.$/, '')), `a correct sentence must stay: ${text}`)
  assert.ok(!summary.result.summary.includes('การซื้อเพิ่มในขนาดเล็กจึงเหมาะสม'), 'the contradicting sentence must be removed')

  // "ใกล้ระดับสนับสนุน" while the price is 6.3% above the support the prompt showed.
  const opportunity = 'RSI อยู่ในโซนสะสมและราคาใกล้ระดับสนับสนุน ทำให้มีโอกาสซื้อเพิ่มที่ราคาต่ำกว่าค่าเฉลี่ยระยะยาว หากผลประกอบการเป็นบวก ราคาจะมีแนวโน้มปรับตัวขึ้น'
  const opp = guard.guardPortfolioAnalysisText(rklb({ risksAndOpportunities: { caution: '', opportunity } }))
  assert.ok(opp.removed >= 1)
  assert.ok(!opp.result.risksAndOpportunities.opportunity.includes('ใกล้ระดับสนับสนุน'))

  // The model already said when the earnings come ("ผลประกอบการจะประกาศใน 4 วันข้างหน้า"): no second notice.
  const caution = 'ผลประกอบการจะประกาศใน 4 วันข้างหน้า ราคาอาจผันผวนอย่างรุนแรง (High Risk). สัดส่วนพอร์ตของ RKLB อยู่ที่ 20% ทำให้ concentration risk สูง; เงินสดสำรองต่ำ (4.6% ของพอร์ต) จึงควรจำกัดขนาดการซื้อเพิ่ม'
  const mentioned = rklb({ risksAndOpportunities: { caution, opportunity: '' } })
  const noNotice = guard.guardPortfolioAnalysisText(mentioned)
  assert.equal(noNotice.noticeAdded, false)
  assert.equal(noNotice.result, mentioned)
  // The summary wording "ผลประกอบการที่ใกล้เข้ามา" alone also counts as a mention.
  assert.equal(guard.guardPortfolioAnalysisText(rklb({ summary: 'ระวังความผันผวนจากผลประกอบการที่ใกล้เข้ามา' })).noticeAdded, false)
  // "หากผลประกอบการเป็นบวก" says nothing about timing, so the notice is still added.
  assert.equal(guard.guardPortfolioAnalysisText(rklb({ summary: 'หากผลประกอบการเป็นบวก ราคามีแนวโน้มขึ้น' })).noticeAdded, true)
}

// EOSE (HOLD, price $2.14, support $1.59, earnings today): none of this may be cut.
{
  const eose = fields => makeResult({
    technical: { ...baseTechnical, support: 1.59, ema50: 2.79, ema200: 6.5 },
    usedPrice: 2.14,
    earnings: { date: '2026-11-05', daysUntil: 0, hour: null },
    ...fields,
  })
  const r = eose({
    summary: 'พอร์ตมีสัดส่วน 12.2% ซึ่งค่อนข้างสูงและเงินสดสำรองต่ำ จึงควรหลีกเลี่ยงการเพิ่มตำแหน่งและรอสัญญาณชัดเจนต่อไป',
    technicalSummary: 'ราคาตอนนี้ $2.14 อยู่ต่ำกว่า EMA50 ($2.79) และ EMA100 ($3.94) แสดงแนวโน้มลงต่อเนื่อง',
    risksAndOpportunities: {
      caution: 'ใกล้ประกาศงบในวันนี้ (0 วัน) ราคาอาจผันผวนอย่างรุนแรง – ควรพิจารณาลดขนาดโพซิชันหรือรอผลประกอบการก่อนทำการซื้อเพิ่ม; สัดส่วนพอร์ต 12.2% สูงอาจเสี่ยง concentration',
      opportunity: 'หากราคาตกสู่แนวรับ $1.59 และ RSI รายวันลดต่ำกว่า 40 อาจเปิดโอกาสซื้อเพิ่มในระดับราคาต่ำ',
    },
    risks: ['ความเสี่ยงจากความผันผวนสูงในวันประกาศผลประกอบการ'],
  })
  const out = guard.guardPortfolioAnalysisText(r)
  assert.equal(out.removed, 0)
  assert.equal(out.noticeAdded, false)
  assert.equal(out.result, r)
}

// Variants of the new wording: cut when it contradicts a HOLD, keep when negated, conditional or about something else.
{
  const cut = ['การซื้อเพิ่มจึงน่าสนใจ', 'การทยอยซื้อในจังหวะนี้เหมาะสม', 'เพิ่มสถานะเล็กน้อยก็เหมาะสม']
  for (const summary of cut) assert.equal(guard.guardPortfolioAnalysisText(makeResult({ summary })).removed, 1, `must be cut for HOLD: ${summary}`)
  const keep = [
    'การซื้อเพิ่มยังไม่เหมาะสม',
    'การซื้อเพิ่มไม่น่าสนใจ',
    'การซื้อเพิ่มจะเหมาะสมเมื่อราคายืนเหนือ 2.4',
    'หากราคาย่อ การซื้อเพิ่มเหมาะสม',
    'ราคายังอยู่เหนือระดับสนับสนุน',
    'ราคาห่างจากระดับสนับสนุนพอสมควร',
  ]
  for (const summary of keep) {
    const r = makeResult({ summary })
    const out = guard.guardPortfolioAnalysisText(r)
    assert.equal(out.removed, 0, `must be kept: ${summary}`)
    assert.equal(out.result, r)
  }
  // The same buy wording is fine when the final action is BUY.
  const buy = makeResult({ summary: 'การซื้อเพิ่มจึงน่าสนใจ', recommendation: { action: 'BUY', buyConditions: '', sellConditions: '' } })
  assert.equal(guard.guardPortfolioAnalysisText(buy).result, buy)
  // "ระดับสนับสนุน" is cut like "แนวรับ" when the price is far from it (price 1.87, support 1.59).
  for (const summary of ['ราคาใกล้ระดับสนับสนุน', 'ราคาทดสอบแนวสนับสนุน']) {
    assert.equal(guard.guardPortfolioAnalysisText(makeResult({ summary })).removed, 1, `support wording must be cut: ${summary}`)
  }
}

// ---------- independent review of PR #152 (head 99edf4db) ----------

const earningsNear = { earnings: { date: '2026-11-09', daysUntil: 4, hour: null } }

// F1: "ผลประกอบการ" denials are removed by the not-near rule, so they never count as a mention and the notice is added.
{
  for (const summary of ['ผลประกอบการยังไม่ใกล้ประกาศ', 'ผลประกอบการยังไม่ถึงกำหนด และไม่ใกล้', 'ผลประกอบการยังอีกนาน', 'ผลประกอบการไม่ได้ใกล้']) {
    const out = guard.guardPortfolioAnalysisText(withText({ summary: `${summary}. ถือต่อ` }, earningsNear))
    assert.ok(out.removed >= 1, `the denial must be removed: ${summary}`)
    assert.equal(out.noticeAdded, true, `the notice must be added after removing: ${summary}`)
  }
  // A miss against the target is not a denial of the date: "ไม่ถึงเป้า" / "ไม่ใกล้เคียงเป้า" stay.
  for (const summary of ['ผลประกอบการไตรมาสก่อนไม่ถึงเป้า', 'ผลประกอบการไตรมาสก่อนไม่ใกล้เคียงเป้า']) {
    const out = guard.guardPortfolioAnalysisText(withText({ summary }, earningsNear))
    assert.equal(out.removed, 0, `must not be cut: ${summary}`)
    assert.equal(out.noticeAdded, true, `no look-ahead mention, so the notice is added: ${summary}`)
  }
}

// F2: only a look-ahead "ผลประกอบการ" counts as a mention.
{
  for (const summary of [
    'ผลประกอบการไตรมาสที่ประกาศไปแล้วออกมาดี',
    'ผลประกอบการปีที่แล้วประกาศกำไรเพิ่ม',
    'ผลประกอบการไตรมาสก่อนดีเกินคาด ใกล้เคียงเป้า',
    'ผลประกอบการใน 3 ปีที่ผ่านมาสม่ำเสมอ',
    `ผลประกอบการ${'ก'.repeat(40)}ใกล้`,
  ]) {
    assert.equal(guard.guardPortfolioAnalysisText(withText({ summary }, earningsNear)).noticeAdded, true, `not a look-ahead mention: ${summary}`)
  }
  for (const summary of ['ผลประกอบการภายใน 4 วันนี้ต้องจับตา', 'ผลประกอบการจะประกาศในอีก 4 วัน', 'ผลประกอบการที่ใกล้เข้ามา', 'ผลประกอบการอีก 4 วันข้างหน้า']) {
    assert.equal(guard.guardPortfolioAnalysisText(withText({ summary }, earningsNear)).noticeAdded, false, `look-ahead mention: ${summary}`)
  }
}

// F3 + F6: every negation form keeps the reversed-order wording, and each alternative and bound is pinned.
{
  for (const summary of [
    'การซื้อเพิ่มไม่ได้เหมาะสม',
    'การซื้อเพิ่มมิได้เหมาะสม',
    'การซื้อเพิ่มไม่ถึงกับเหมาะสม',
    'การซื้อเพิ่มใช่ว่าจะเหมาะสม',
    'การซื้อเพิ่มไม่ค่อยเหมาะสม',
    'การซื้อเพิ่มยังไม่เหมาะสม',
    'การซื้อเพิ่มไม่น่าสนใจ',
    `การซื้อเพิ่ม${'ก'.repeat(40)}เหมาะสม`,
    'การซื้อเพิ่ม ราคานี้ เหมาะสม',
  ]) {
    const r = makeResult({ summary })
    const out = guard.guardPortfolioAnalysisText(r)
    assert.equal(out.removed, 0, `must be kept: ${summary}`)
    assert.equal(out.result, r)
  }
  for (const summary of ['การซื้อเพิ่มคุ้มค่า', 'การทยอยซื้อน่าซื้อ', 'การสะสมในจังหวะนี้เหมาะ', 'การซื้อเพิ่มค่อนข้างน่าสนใจ']) {
    assert.equal(guard.guardPortfolioAnalysisText(makeResult({ summary })).removed, 1, `must be cut for HOLD: ${summary}`)
  }
}

// ---------- Cron wording seen in the saved Production analyses of 2026-11-07 (v1.41.28) ----------
// The Cron batch prompt writes "ราคาติดระดับสนับสนุน" / "ราคาติดเหนือค่า support". These sentences are copied from the
// saved analyses (all HOLD except NOW) together with the price and support that were stored with them.

{
  const cron = (price, support, fields, extra = {}) => makeResult({
    technical: { ...baseTechnical, support },
    usedPrice: price,
    ...fields,
    ...extra,
  })
  const guardNote = 'Scale-in Guard: ไม่มี New Trigger — ราคา/เทคนิคัลยังไม่เปลี่ยนมากพอจากไม้ล่าสุด (เกณฑ์ movement ขั้นต่ำ 5.5%) และยังไม่ถึง prior support หรือ breakout/momentum confirmation ใหม่; เวลาเพียงอย่างเดียวไม่ปลดล็อก BUY ซ้ำ'

  // Far from support (more than 5%): the claim goes, a system note stays.
  const tooFar = [
    ['EOSE', 1.74, 1.59, 'หุ้น EOSE อยู่ใน Downtrend RSI 40, ราคาติดระดับสนับสนุนใกล้ค่า cost จึงคงไว้เพื่อดูการฟื้นตัว', 'ติดระดับสนับสนุน'],
    ['ORCL', 116.1, 109.21, `${guardNote}\nORCL มี RSI 38.6 <45, ราคาติดระดับสนับสนุน 109.21 ใกล้ราคา 116.1, ไม่มีข่าวลบรุนแรง`, 'ติดระดับสนับสนุน'],
    ['NVO', 40.3, 37.9, 'NVO อยู่ใน Downtrend RSI 52.8, ราคาติดเหนือค่า support 37.9, กำไรขาดทุน -24.9%', 'ติดเหนือค่า support'],
    ['SOFI', 16.04, 13.86, 'SOFI มี RSI 49.6, อยู่ใน Downtrend, ราคาติดเหนือ support 13.86 แต่ไม่มีสัญญาณซื้อชัดเจน', 'ติดเหนือ support'],
  ]
  for (const [symbol, price, support, summary, claim] of tooFar) {
    const out = guard.guardPortfolioAnalysisText(cron(price, support, { symbol, summary }))
    assert.ok(out.removed >= 1, `${symbol}: the "ติด…สนับสนุน" claim must be removed (price ${price}, support ${support})`)
    assert.ok(!out.result.summary.includes(claim), `${symbol}: the claim must be gone: ${out.result.summary}`)
    assert.ok(out.result.summary.length > 0, `${symbol}: the summary must not be left empty`)
  }
  const orcl = guard.guardPortfolioAnalysisText(cron(116.1, 109.21, { summary: tooFar[1][3] }))
  assert.ok(orcl.result.summary.startsWith(guardNote), 'The system guard note must stay')

  // Within 5% of support: the same wording is true and must stay (VRT 3.5% above, NOW 0.6% above and BUY).
  const vrt = cron(176.73, 170.8, { summary: 'VRT มี RSI 34.1 <45, ราคาติดระดับสนับสนุน 170.8 ใกล้ราคา 176.7, ไม่มีข่าวลบรุนแรง' })
  assert.equal(guard.guardPortfolioAnalysisText(vrt).result, vrt)
  const now = cron(102.36, 101.8, {
    summary: 'NOW มี RSI 27.8 ต่ำ, ราคาติดสนับสนุน 101.8 ใกล้ราคา 102.36, ไม่มีข่าวลบรุนแรง',
    recommendation: { action: 'BUY', buyConditions: '', sellConditions: '' },
  })
  assert.equal(guard.guardPortfolioAnalysisText(now).result, now)

  // WDC (pre-market, price 291 is below support 321.6): a conditional "ติด support" opportunity stays.
  const wdc = cron(291, 321.6, { risksAndOpportunities: { caution: '', opportunity: 'โอกาสซื้อเมื่อราคาติด support และ RSI ลดลง' } })
  assert.equal(guard.guardPortfolioAnalysisText(wdc).result, wdc)

  // Negated, conditional and unrelated "ติด" sentences stay even when the price is far from support (1.74 vs 1.59 is 9.4%).
  for (const summary of [
    'ราคาไม่ได้ติดระดับสนับสนุน',
    'หากราคาติดระดับสนับสนุน ค่อยพิจารณา',
    'ราคาติดลบต่อเนื่อง',
    'ราคาติดแนวต้านมาหลายวัน',
    'ราคาห่างจากระดับสนับสนุนพอสมควร',
  ]) {
    const r = cron(1.74, 1.59, { summary })
    const out = guard.guardPortfolioAnalysisText(r)
    assert.equal(out.removed, 0, `must be kept: ${summary}`)
    assert.equal(out.result, r)
  }
  // The bare verb "ติด" is not enough without a support noun right after it.
  assert.equal(guard.guardPortfolioAnalysisText(cron(1.74, 1.59, { summary: 'ราคาติดกรอบบนของช่วงราคาอยู่ไม่ไกล' })).removed, 0)
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
