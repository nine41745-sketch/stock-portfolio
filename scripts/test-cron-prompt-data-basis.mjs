import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const batch = read('lib/portfolio-batch.ts')

// ---------- locate the one prompt template used by both Cron routes ----------
assert.equal(batch.split('const prompt = `').length, 2, 'exactly one prompt template in lib/portfolio-batch.ts')
const promptStart = batch.indexOf('const prompt = `')
const inputAt = batch.indexOf('INPUT=${JSON.stringify(payload)}`', promptStart)
assert.ok(promptStart > 0 && inputAt > promptStart, 'prompt markers')
const prompt = batch.slice(promptStart, inputAt)

// ---------- the new rule ----------
const ruleStart = prompt.indexOf('กติกาการอ้างข้อมูล (v1.41.41):')
assert.ok(ruleStart > 0, 'the data-basis rule exists in the Cron prompt')
assert.equal(prompt.split('กติกาการอ้างข้อมูล').length, 2, 'the rule appears once')
const rule = prompt.slice(ruleStart, prompt.indexOf('\n', ruleStart))
for (const phrase of [
  'อ้างเฉพาะข้อมูลใน INPUT เท่านั้น',
  'ห้ามใช้ความจำของโมเดลเติมข่าว ผลประกอบการ หรือตัวเลขการเงินของบริษัท',
  'INPUT ไม่มีงบการเงิน รายได้ กำไรสุทธิ หนี้สิน กระแสเงินสด จึงห้ามอ้างถึง',
  'พูดถึงพื้นฐานได้เฉพาะจาก pe/hi/lo ที่ให้มา',
  'ถ้า news ว่างให้ถือว่า "ไม่ได้รับข่าวในรอบนี้" (ไม่ได้แปลว่าบริษัทไม่มีข่าว)',
  'ห้ามเขียนว่า "ไม่มีข่าวสำคัญ" หรือ "ไม่มีข่าวร้าย"',
]) assert.ok(rule.includes(phrase), 'rule keeps: ' + phrase)
assert.ok(rule.length < 600, 'rule stays short for the Groq token limit: ' + rule.length)

// the rule only names fields that compactInput really sends (and not data that is never sent)
const compactStart = batch.indexOf('function compactInput(')
const compactEnd = batch.indexOf('\n}\n', compactStart)
const compact = batch.slice(compactStart, compactEnd)
for (const key of ['pe:', 'hi:', 'lo:', 'news:']) assert.ok(compact.includes(key), 'compactInput sends ' + key)
for (const never of ['revenue', 'netIncome', 'debt', 'cashFlow']) assert.ok(!compact.includes(never), 'compactInput must not send ' + never + ' (the rule says it is not provided)')
assert.ok(compact.includes('news.slice(0, 2)'), 'the Cron prompt sends at most 2 headlines')

// ---------- placement: after the action rules, before the output format and INPUT ----------
const actionRulesAt = prompt.indexOf('กติกา action:')
const sellAllAt = prompt.indexOf('1) SELL_ALL เฉพาะ thesis-breaking')
const holdAt = prompt.indexOf('4) HOLD เมื่อไม่เข้าเงื่อนไขข้างต้น')
const newsSplitAt = prompt.indexOf('แยกข่าว company-specific กับ macro/sector')
const jsonlAt = prompt.indexOf('สำคัญมาก: ตอบเป็น JSONL เท่านั้น')
assert.ok(actionRulesAt > 0 && sellAllAt > actionRulesAt && holdAt > sellAllAt, 'action rules still present and in order')
assert.ok(newsSplitAt > holdAt && ruleStart > newsSplitAt && jsonlAt > ruleStart, 'the rule sits after the action rules and before the JSONL format')

// ---------- the action rules and output format are unchanged ----------
for (const phrase of [
  'ต้อง tb=true + et อย่างน้อย 1 ค่าใน allowlist: FUNDAMENTAL_DETERIORATION,FRAUD_GOVERNANCE,SOLVENCY_LIQUIDITY,STRUCTURAL_COMPETITIVE_LOSS,SEVERE_REGULATORY_LEGAL,BUSINESS_MODEL_IMPAIRMENT,OTHER_PERMANENT_IMPAIRMENT',
  'ห้ามใช้ EMA/MACD/RSI/downtrend/P&L/macro/sector เป็นเหตุ SELL_ALL เพียงลำพัง',
  '2) SELL_PARTIAL เมื่อ P&L>20%, RSI Day>70',
  '3) BUY เมื่อไม่เข้า 1-2, earnings ไม่อยู่ใน 7 วัน',
  'ห้ามเดาราคา/forward P/E',
  'ตอบเป็น JSONL เท่านั้น = 1 JSON object ต่อ 1 บรรทัด',
  'ถ้า a ไม่ใช่ SELL_ALL ต้อง tb=false,et=[],ev=[]',
]) assert.ok(prompt.includes(phrase), 'unchanged: ' + phrase)

// ---------- scope: manual-analysis prompt and the claim guard are not touched by this change ----------
const groq = read('lib/groq.ts')
assert.ok(groq.includes('กติกาการอ้างข้อมูล:'), 'the manual-analysis rule from v1.41.39 is still in lib/groq.ts')
console.log('✓ Cron prompt data-basis rule regression tests passed')
