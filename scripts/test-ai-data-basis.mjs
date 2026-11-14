import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const groq = read('lib/groq.ts')
const dashboard = read('components/portfolio/PortfolioDashboard.tsx')

// ---------- the builder (behavioural): extracted from lib/groq.ts, transpiled and run ----------
const startMarker = '// v1.41.38 (data basis)'
const endMarker = 'export async function analyzeHoldingDetailed('
const start = groq.indexOf(startMarker)
const end = groq.indexOf(endMarker)
assert.ok(start > 0 && end > start, 'builder markers')
const builderSource = groq.slice(start, end)
const compiled = ts.transpileModule(builderSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true }, reportDiagnostics: true })
const errors = (compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
assert.equal(errors.length, 0, 'builder transpiles: ' + errors.map(d => d.messageText).join('; '))
const { buildDataAvailabilityBlock, AI_INPUT_NOT_PROVIDED } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

assert.equal(AI_INPUT_NOT_PROVIDED, 'งบการเงิน รายได้ กำไรสุทธิ หนี้สิน กระแสเงินสด')
const noNews = buildDataAvailabilityBlock({ newsCount: 0, hasMetrics: true })
assert.match(noNews, /- ข่าว: ไม่ได้รับข่าวล่าสุดในรอบนี้/, 'no news is described as "not received"')
assert.match(noNews, /ไม่ได้แปลว่าบริษัทไม่มีข่าว/, 'an empty news list must not be read as "the company has no news"')
assert.doesNotMatch(noNews, /ได้รับ 0 /, 'never "received 0 headlines"')
const someNews = buildDataAvailabilityBlock({ newsCount: 3, hasMetrics: true })
assert.match(someNews, /- ข่าว: ได้รับ 3 หัวข้อ \(ตามรายการข้างต้น\)/)
assert.doesNotMatch(someNews, /ไม่ได้รับข่าวล่าสุด/, 'the "not received" wording only appears when there is no news')
assert.match(buildDataAvailabilityBlock({ newsCount: 1, hasMetrics: true }), /- P\/E และ 52W: ได้รับตามบรรทัด Valuation\/Metrics ข้างต้น/)
assert.match(buildDataAvailabilityBlock({ newsCount: 1, hasMetrics: false }), /- P\/E และ 52W: ไม่ได้รับ(\n|$)/)
for (const block of [noNews, someNews, buildDataAvailabilityBlock({ newsCount: 4, hasMetrics: false })]) {
  assert.ok(block.endsWith(`- ไม่ได้รับ: ${AI_INPUT_NOT_PROVIDED}`), 'the list of data that is never sent is always the last line')
  assert.equal(block.split('\n').length, 3, 'three short lines (the prompt size stays small for the Groq token limit)')
  assert.ok(block.length < 330, 'block stays short: ' + block.length)
}

// ---------- the prompt (source checks) ----------
const dynamicMarker = '=== ข้อมูลสำหรับวิเคราะห์ครั้งนี้ (เปลี่ยนทุกครั้งตามคำขอ) ==='
const dynamicAt = groq.indexOf(dynamicMarker)
const ruleAt = groq.indexOf('กติกาการอ้างข้อมูล:')
assert.ok(dynamicAt > 0 && ruleAt > 0, 'markers')
assert.ok(ruleAt < dynamicAt, 'the rule is part of the static prefix, so the per-request data stays at the end (Groq prompt caching)')
const rule = groq.slice(ruleAt, groq.indexOf('\n', ruleAt))
for (const phrase of [
  'ห้ามอ้างข่าว ผลประกอบการ ตัวเลขการเงิน หรือเหตุการณ์ของบริษัทที่ไม่ได้อยู่ในส่วน "ข้อมูลสำหรับวิเคราะห์ครั้งนี้"',
  'ห้ามใช้ความจำของโมเดลเรื่องบริษัทมาเติม',
  'ไม่ได้รับข้อมูล…ในการวิเคราะห์นี้',
  'ห้ามเขียนว่า "ไม่มีข่าวสำคัญ" หรือ "ไม่มีข่าวร้าย" เมื่อไม่ได้รับข่าว',
  'ระบบไม่ได้รับข่าวล่าสุด',
  'พูดถึง "พื้นฐาน" ได้เฉพาะจาก P/E กับ 52W ที่ให้มา',
  'ความเชื่อมั่นต่ำ',
]) assert.ok(rule.includes(phrase), 'rule keeps: ' + phrase)
assert.ok(rule.length < 600, 'the rule stays short: ' + rule.length)
assert.doesNotMatch(rule, /[`]|\$\{/, 'no template-literal hazards inside the prompt rule')

const newsAt = groq.indexOf('=== ข่าวสารและปัจจัยกระทบล่าสุด ===\n${newsSnippet}')
const blockAt = groq.indexOf('=== ข้อมูลที่ได้รับและไม่ได้รับในการวิเคราะห์นี้ ===\n${dataAvailability}')
assert.ok(newsAt > dynamicAt && blockAt > newsAt, 'the availability block comes right after the news section, inside the per-request part')
assert.match(groq, /const dataAvailability = buildDataAvailabilityBlock\(\{ newsCount: Math\.min\(recentNews\.length, 4\), hasMetrics: metricsInfo !== '' \}\)/, 'the count matches the 4 headlines the prompt can show, and metrics availability comes from the real metrics line')
assert.match(groq, /recentNews\.slice\(0, 4\)/, 'the prompt shows at most 4 headlines (the count above depends on it)')
assert.match(groq, /"opportunity": "โอกาสหรือปัจจัยบวก \(อ้างจากข้อมูลที่ได้รับเท่านั้น\)"/)
// the decision framework is not touched by this change
for (const pinned of [
  'กติกาสำคัญที่สุด: แค่เงื่อนไขย่อยข้อเดียวเป็นจริงก็เพียงพอให้เลือก action นั้นได้ทันที',
  '1. SELL_ALL (ขายทั้งหมด) — เป็น action ที่มี threshold สูงที่สุด',
  '4. HOLD (ถือต่อ) — ใช้ได้เฉพาะเมื่อเช็กครบข้อ 1-3',
  "'FUNDAMENTAL_DETERIORATION',",
]) assert.ok(groq.includes(pinned), 'unchanged: ' + pinned.slice(0, 40))

// ---------- the screen ----------
const uiConst = dashboard.match(/const AI_INPUT_NOT_PROVIDED = '([^']+)'/)
assert.ok(uiConst, 'the screen has its own copy of the phrase')
assert.equal(uiConst[1], AI_INPUT_NOT_PROVIDED, 'the screen lists exactly what the prompt says is never sent')
assert.match(dashboard, /const usedNewsCount = analysis\.usedNews\?\.length \?\? 0/)
assert.match(dashboard, /'ไม่ได้รับข่าวล่าสุด \(อาจดึงไม่สำเร็จ ไม่ได้แปลว่าไม่มีข่าว\)'/)
assert.match(dashboard, /usedNewsCount > 0 \? `ข่าว \$\{usedNewsCount\} ชิ้น`/)
const lineAt = dashboard.indexOf('data-testid="analysis-data-basis"')
const keyFactsAt = dashboard.indexOf('data-testid="analysis-key-facts"')
const premarketAt = dashboard.indexOf("analysis.analysisMode === 'PREMARKET_TRIGGER'")
assert.ok(keyFactsAt > 0 && lineAt > keyFactsAt && lineAt < premarketAt, 'the line sits right under the key numbers')
const line = dashboard.slice(lineAt, dashboard.indexOf('</p>', lineAt))
assert.ok(line.includes('ข้อมูลที่ AI ได้รับ: ราคา · ตัวชี้วัดเทคนิค · P/E และ 52W (ถ้ามี) · {dataBasisNews} | ไม่ได้รับ: {AI_INPUT_NOT_PROVIDED}'))
assert.ok(dashboard.slice(0, lineAt).lastIndexOf('<p className="mt-1 text-[11px] leading-relaxed text-gray-500"') > keyFactsAt, 'small, quiet text')

// ---------- scope ----------
for (const file of ['lib/portfolio-ai-claim-guard.ts', 'lib/finnhub.ts', 'proxy.ts', 'vercel.json', 'lib/portfolio-batch.ts']) {
  assert.doesNotMatch(read(file), /buildDataAvailabilityBlock|AI_INPUT_NOT_PROVIDED|analysis-data-basis/, file + ' is not part of this change')
}
for (const file of fs.readdirSync('app/api/cron', { recursive: true }).filter(f => String(f).endsWith('.ts'))) {
  assert.doesNotMatch(read(`app/api/cron/${file}`), /buildDataAvailabilityBlock|AI_INPUT_NOT_PROVIDED/, 'cron handler untouched: ' + file)
}

console.log('✓ AI data basis (prompt rule, availability block and screen line) regression tests passed')
