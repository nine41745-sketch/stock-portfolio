import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync('components/portfolio/PortfolioDashboard.tsx', 'utf8').replace(/\r\n/g, '\n')

// ---------- date: four-digit Buddhist year, short month, no ambiguous two-digit year ----------
const fnMatch = src.match(/function fmtDateTime\(iso: string\) \{\n([\s\S]*?)\n\}\n/)
assert.ok(fnMatch, 'fmtDateTime must exist')
const BANGKOK_TIME_ZONE = 'Asia/Bangkok'
const fmtDateTime = new Function('BANGKOK_TIME_ZONE', 'iso', fnMatch[1])
const shown = fmtDateTime(BANGKOK_TIME_ZONE, '2026-11-12T14:16:00Z')
assert.match(shown, /^12 .+ 2569 เวลา 21:16 น\.$/, 'date shows the 4-digit Buddhist year and Bangkok time: ' + shown)
assert.doesNotMatch(shown, /\/69/, 'no two-digit year')
assert.doesNotMatch(fnMatch[1], /year: '2-digit'/, 'the year must not be two digits')
assert.match(fnMatch[1], /year: 'numeric'/)

// ---------- the AI analysis panel ----------
const start = src.indexOf('const techChips')
const end = src.indexOf('const sortedHoldings')
assert.ok(start > 0 && end > start, 'panel markers')
const panel = src.slice(start, end)

// key numbers right under the summary, built from data the panel already has
assert.match(panel, /const keyFacts: Array<\{ label: string; value: string \}> = \[/)
assert.match(panel, /typeof analysis\.usedPrice === 'number'/, 'price is shown only when it is a number')
assert.match(panel, /\/pre-\?market\/i\.test\(analysis\.priceSource\)/, 'the price is labelled by its source, not guessed')
assert.match(panel, /'ราคาก่อนตลาดเปิด' : 'ราคาที่ใช้วิเคราะห์'/)
assert.match(panel, /label: 'แนวรับ'[\s\S]*label: 'แนวต้าน'/)
assert.match(panel, /data-testid="analysis-key-facts"/)
const summaryAt = panel.indexOf('{analysis.summary &&')
const keyFactsAt = panel.indexOf('data-testid="analysis-key-facts"')
const premarketAt = panel.indexOf("analysis.analysisMode === 'PREMARKET_TRIGGER'")
assert.ok(summaryAt > 0 && keyFactsAt > summaryAt && keyFactsAt < premarketAt, 'key numbers sit between the summary and the pre-market box')

// the technical sentence stays visible, the chips (same numbers) are collapsed
const techAt = panel.indexOf('{analysis.technicalSummary && (')
const chipsAt = panel.indexOf('ดูตัวเลขเทคนิคทั้งหมด')
const detailsAt = panel.lastIndexOf('<details className="mt-2">', chipsAt)
assert.ok(techAt > 0 && detailsAt > techAt && chipsAt > detailsAt, 'chips live inside a collapsed details under the sentence')
assert.ok(panel.indexOf('{analysis.technicalSummary}') > techAt && panel.indexOf('{analysis.technicalSummary}') < detailsAt, 'the sentence is outside the details')
assert.doesNotMatch(panel.slice(techAt, detailsAt), /techChips\.map/, 'chips are not rendered outside the details')
assert.match(panel, /ดูตัวเลขเทคนิคทั้งหมด \(\{techChips\.length\}\)/)

// one "things to watch" card with all three kinds of content, and the plan before it
const watchAt = panel.indexOf('data-testid="analysis-watch-card"')
const planAt = panel.indexOf('📌 แผนการเทรด')
assert.ok(planAt > techAt && watchAt > planAt, 'trading plan comes before the watch card')
assert.match(panel, /👀 สิ่งที่ต้องจับตา/)
const watch = panel.slice(watchAt, panel.indexOf("{settingsLoaded && cashBalanceUSD > 0 && action === 'BUY'"))
for (const part of ['risksAndOpportunities.caution', 'risksAndOpportunities.opportunity', 'analysis.risks.map', 'ข้อควรระวัง: ', 'โอกาส: ', 'ความเสี่ยงหลัก']) {
  assert.ok(watch.includes(part), 'watch card keeps ' + part)
}
assert.match(panel, /\(analysis\.risksAndOpportunities\.caution \|\| analysis\.risksAndOpportunities\.opportunity \|\| analysis\.risks\.length > 0\)/, 'the card shows when any of the three has content')
assert.equal((panel.match(/🚩 ความเสี่ยงหลัก/g) ?? []).length, 1, 'the old standalone risk box is gone')
assert.doesNotMatch(panel, /🌱 โอกาส<\/p>/, 'the old standalone opportunity box is gone')

// model name and disclaimer move to the footer; the model name is no longer in the header
assert.equal((panel.match(/\{modelLabel\}/g) ?? []).length, 2, 'model name appears in the sources chip and the footer line only')
const headerEnd = panel.indexOf('{analysis.summary &&')
assert.doesNotMatch(panel.slice(0, headerEnd), /\{modelLabel && <span className="text-\[10px\] text-gray-600">/, 'the header no longer shows the model name')
const footerAt = panel.indexOf('data-testid="analysis-footer"')
const sourcesAt = panel.indexOf('📊 ข้อมูลอ้างอิง')
assert.ok(footerAt > sourcesAt, 'the footer comes after the sources')
assert.match(panel.slice(footerAt), /\{analysis\.disclaimer && <p className="text-\[11px\] italic text-gray-500">⚠️ \{analysis\.disclaimer\}<\/p>\}/, 'the disclaimer is still shown, now in the footer')
assert.equal((panel.match(/\{analysis\.disclaimer\}/g) ?? []).length, 1, 'the disclaimer is rendered once')
assert.match(panel, /<details className="mt-3 border-t border-gray-800 pt-3">/, 'the sources stay collapsed')

// ---------- table column ----------
assert.match(src, /<th className="px-3 py-2\.5 text-right" title="วันที่แก้ไขรายการหุ้นนี้ล่าสุด \(ไม่ใช่เวลาของราคา\)">แก้ไขล่าสุด<\/th>/)
assert.doesNotMatch(src, /<th className="px-3 py-2\.5 text-right">อัปเดต<\/th>/, 'the old ambiguous column label is gone')

// ---------- scope: nothing outside the screen changed ----------
for (const file of ['lib/groq.ts', 'lib/portfolio-ai-claim-guard.ts', 'lib/finnhub.ts', 'proxy.ts', 'vercel.json']) {
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /analysis-key-facts|analysis-watch-card|keyFacts/, file + ' is not part of this change')
}

console.log('✓ AI analysis panel readability regression tests passed')
