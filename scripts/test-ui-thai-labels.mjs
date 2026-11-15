import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const calendarUi = read('components/portfolio/MarketCalendar.tsx')
const calendarLib = read('lib/market-calendar.ts')
const discovery = read('components/portfolio/DiscoveryWorkspace.tsx')
const dashboard = read('components/portfolio/PortfolioDashboard.tsx')

function transpileToModule(source, label) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${label} transpiles: ` + errors.map(d => d.messageText).join('; '))
  return compiled.outputText
}
const importSource = async (source, label) =>
  import(`data:text/javascript;base64,${Buffer.from(transpileToModule(source, label)).toString('base64')}`)

// ---------- calendar helpers (behavioural): the block is cut out of the component, transpiled and run ----------
const blockStart = calendarUi.indexOf('function thaiDate(date: string)')
const blockEnd = calendarUi.indexOf('// end v1.41.40 (thai labels)')
assert.ok(blockStart > 0 && blockEnd > blockStart, 'thai label block markers')
const helpers = await importSource(
  calendarUi.slice(blockStart, blockEnd) + '\nexport { TYPE_LABEL_TH, NOTE_TH, noteTh, eventTitleTh, timingTh, newYorkToThai }\n',
  'calendar helpers',
)
const { TYPE_LABEL_TH, NOTE_TH, noteTh, eventTitleTh, timingTh, newYorkToThai } = helpers

// New York -> Thai time follows daylight saving (EST = UTC-5, EDT = UTC-4); Thailand has none (UTC+7)
assert.deepEqual(newYorkToThai('2026-12-09', 14, 0), { date: '2026-12-10', time: '02:00' }, 'winter FOMC decision 14:00 EST = 02:00 next day')
assert.deepEqual(newYorkToThai('2026-12-10', 8, 30), { date: '2026-12-10', time: '20:30' }, 'winter CPI 08:30 EST = 20:30 same day')
assert.deepEqual(newYorkToThai('2026-07-29', 14, 0), { date: '2026-07-30', time: '01:00' }, 'summer FOMC decision 14:00 EDT = 01:00 next day')
assert.deepEqual(newYorkToThai('2026-09-11', 8, 30), { date: '2026-09-11', time: '19:30' }, 'summer CPI 08:30 EDT = 19:30 same day')
assert.deepEqual(newYorkToThai('2026-10-31', 8, 30), { date: '2026-10-31', time: '19:30' }, 'the day before daylight saving ends is still EDT')
assert.deepEqual(newYorkToThai('2026-11-02', 8, 30), { date: '2026-11-02', time: '20:30' }, 'the day after daylight saving ends is EST')
assert.deepEqual(newYorkToThai('2026-03-09', 8, 30), { date: '2026-03-09', time: '19:30' }, 'the day after daylight saving starts is EDT')

const fomc = { type: 'FOMC', title: 'FOMC Meeting', date: '2026-12-08', endDate: '2026-12-09', timing: 'Decision Dec 9 · 14:00 ET' }
const fomcText = timingTh(fomc)
assert.ok(fomcText.startsWith('ประกาศผลเวลา 14:00 น. ตามเวลานิวยอร์ก (ET)'), fomcText)
assert.ok(fomcText.includes('10 ธ.ค. 2569 เวลา 02:00 น. ตามเวลาไทย'), 'FOMC decision uses the last day of the meeting: ' + fomcText)
const cpi = { type: 'CPI', title: 'US CPI — November 2026', date: '2026-12-10', endDate: null, timing: '08:30 ET' }
const cpiText = timingTh(cpi)
assert.ok(cpiText.startsWith('เวลา 08:30 น. ตามเวลานิวยอร์ก (ET)') && cpiText.includes('10 ธ.ค. 2569 เวลา 20:30 น. ตามเวลาไทย'), cpiText)
assert.equal(timingTh({ type: 'EARNINGS', title: 'X', date: '2026-12-14', endDate: null, timing: 'After market close' }), 'หลังตลาดปิด')
assert.equal(timingTh({ type: 'EARNINGS', title: 'X', date: '2026-12-14', endDate: null, timing: 'Before market open' }), 'ก่อนตลาดเปิด')
assert.equal(timingTh({ type: 'EARNINGS', title: 'X', date: '2026-12-14', endDate: null, timing: 'During market hours' }), 'ระหว่างตลาดเปิด')
assert.equal(timingTh({ type: 'EARNINGS', title: 'X', date: '2026-12-14', endDate: null, timing: null }), null, 'no timing stays empty')
assert.equal(timingTh({ type: 'CPI', title: 'X', date: '2026-12-14', endDate: null, timing: 'sometime later' }), 'sometime later', 'unknown timing text is shown as it came')

assert.equal(eventTitleTh({ type: 'EARNINGS', title: 'ORCL Earnings' }), 'ประกาศงบ', 'the ticker is already shown, so the title must not repeat it')
assert.equal(eventTitleTh({ type: 'CPI', title: 'US CPI — November 2026' }), 'ดัชนีราคาผู้บริโภคสหรัฐ (CPI) เดือนพฤศจิกายน 2569')
assert.equal(eventTitleTh({ type: 'CPI', title: 'US CPI — January 2027' }), 'ดัชนีราคาผู้บริโภคสหรัฐ (CPI) เดือนมกราคม 2570')
assert.equal(eventTitleTh({ type: 'CPI', title: 'Something else' }), 'Something else', 'unknown title is shown as it came')
assert.ok(eventTitleTh({ type: 'FOMC', title: 'FOMC Meeting' }).includes('FOMC'))
assert.deepEqual(Object.keys(TYPE_LABEL_TH).sort(), ['CPI', 'EARNINGS', 'FOMC'])
assert.equal(noteTh(null), null)
assert.equal(noteTh('A note nobody translated'), 'A note nobody translated')

// every English note and ET time the data (and the earnings builder) can produce must have a Thai form, so a new date never silently shows English only
const notes = [...calendarLib.matchAll(/note: '([^']+)'/g)].map(m => m[1])
assert.ok(notes.length > 10, 'notes found in lib/market-calendar.ts: ' + notes.length)
for (const note of [...new Set(notes)]) assert.ok(NOTE_TH[note] && NOTE_TH[note] !== note, 'Thai text for note: ' + note)
const earningsNote = /note: '(Company earnings calendar[^']+)'/.exec(calendarLib)?.[1]
assert.ok(earningsNote && NOTE_TH[earningsNote], 'earnings note has a Thai text')
const metadataNote = /note: '(Macro dates[^']+)'/.exec(calendarLib)?.[1]
assert.ok(metadataNote && NOTE_TH[metadataNote], 'footer metadata note has a Thai text')
for (const timing of [...new Set([...calendarLib.matchAll(/timing: '([^']*ET)'/g)].map(m => m[1]))]) {
  const out = timingTh({ type: timing.startsWith('Decision') ? 'FOMC' : 'CPI', title: 'x', date: '2026-12-08', endDate: '2026-12-09', timing })
  assert.ok(out.includes('ตามเวลาไทย'), 'Thai time for: ' + timing)
}
for (const timing of ['Before market open', 'After market close', 'During market hours']) assert.ok(calendarLib.includes(timing), 'earnings timing still produced by the lib: ' + timing)

// ---------- calendar screen (source): Thai helpers used, safety text and pinned strings kept ----------
assert.ok(calendarUi.includes('{eventTitleTh(event)}') && !calendarUi.includes('{event.title}'), 'title is shown through the Thai helper')
assert.ok(calendarUi.includes('{timingTh(event)}') && !calendarUi.includes('{event.timing}'), 'timing is shown through the Thai helper')
assert.ok(calendarUi.includes('{noteTh(event.note)}') && !calendarUi.includes('{event.note}'), 'note is shown through the Thai helper')
assert.ok(calendarUi.includes('{noteTh(data.calendarMetadata.note)}') && !calendarUi.includes('{data.calendarMetadata.note}'), 'footer note is shown through the Thai helper')
assert.ok(calendarUi.includes('{event.type} · {TYPE_LABEL_TH[event.type]}'), 'badge keeps the English code and adds the Thai meaning')
assert.ok(calendarUi.includes('Macro schedule snapshot ตรวจล่าสุด'), 'last-checked text stays')
assert.ok(calendarUi.includes('หน้าปฏิทินเป็นแบบอ่านอย่างเดียว และไม่สร้างคำสั่งซื้อขายอัตโนมัติ'), 'read-only statement stays')
assert.ok(calendarUi.includes('Source: {event.source}'), 'source line stays')
assert.ok(calendarUi.includes('Earnings ของหุ้นที่ติดตาม พร้อม US CPI และ FOMC'), 'subtitle pinned by test-alerts-calendar stays')
assert.ok(!/ทำให้ตลาด(ขึ้น|ลง)/.test(calendarUi.slice(blockStart, blockEnd)), 'no market-direction claims in the explanations')
assert.ok(!/(ควรซื้อ|ควรขาย)/.test(calendarUi.slice(blockStart, blockEnd)), 'no buy/sell advice in the explanations')

// ---------- discovery theme names ----------
const themeBlock = /const THEME_NAMES[^{]*\{([\s\S]*?)\n\}/.exec(discovery)?.[1]
assert.ok(themeBlock, 'THEME_NAMES block')
const themes = Object.fromEntries([...themeBlock.matchAll(/(\w+): '([^']+)'/g)].map(m => [m[1], m[2]]))
assert.deepEqual(Object.keys(themes).sort(), ['ai', 'growth', 'quality', 'semis'])
assert.equal(themes.ai, 'AI และเทคโนโลยียักษ์ใหญ่ (AI / Mega Tech)')
assert.equal(themes.semis, 'เซมิคอนดักเตอร์ (Semiconductors)')
assert.equal(themes.growth, 'เทคโนโลยีเติบโต (Growth Technology)')
assert.equal(themes.quality, 'หุ้นคุณภาพ (Quality)')
for (const [key, name] of Object.entries(themes)) { assert.match(name, /[ก-๙]/, `theme ${key} contains Thai`); assert.match(name, /\([A-Za-z /]+\)$/, `theme ${key} ends with the English name in brackets`) }
assert.match(discovery, /Investment Discovery\) · \{CURRENT_VERSION\}/, 'heading pinned by test-critical stays')
assert.ok(discovery.includes('กลุ่มหุ้นคัดสรร (Expanded Market Radar)'), 'radar button text used by the browser QA stays')

// ---------- dashboard order: biggest position first, on the table and on the mobile cards ----------
assert.ok(dashboard.includes("useState<string | null>('market_value')"), 'default sort field is market value')
assert.ok(dashboard.includes("useState<'asc' | 'desc'>('desc')"), 'default direction is biggest first')
assert.ok(dashboard.includes('<SortTh field="market_value"'), 'the market value header can still be clicked')
assert.ok(!dashboard.includes('{holdings.map(h => {'), 'the mobile cards must not use the unsorted list')
assert.equal(dashboard.split('{sortedHoldings.map(h => {').length, 3, 'table and mobile cards both use the sorted list')
const memoStart = dashboard.indexOf('const sortedHoldings = useMemo(() => {')
const memoEnd = dashboard.indexOf('}, [holdings, sortField, sortDir])', memoStart)
assert.ok(memoStart > 0 && memoEnd > memoStart, 'sortedHoldings block')
const sortModule = await importSource(
  `export function build(holdings: any[], sortField: string | null, sortDir: 'asc' | 'desc') {\n  const useMemo = (fn: () => any) => fn()\n  ${dashboard.slice(memoStart, memoEnd)}}, [])\n  return sortedHoldings\n}\n`,
  'sortedHoldings',
)
const rows = [
  { symbol: 'AAA', shares: 1, market_value: 100 },
  { symbol: 'BBB', shares: 1, market_value: null },
  { symbol: 'CCC', shares: 1, market_value: 300 },
  { symbol: 'DDD', shares: 1, market_value: 200 },
  { symbol: 'EEE', shares: 1, market_value: null },
]
assert.deepEqual(sortModule.build(rows, 'market_value', 'desc').map(r => r.symbol), ['CCC', 'DDD', 'AAA', 'BBB', 'EEE'], 'biggest first, holdings without a value last (API order kept among them)')
assert.deepEqual(sortModule.build(rows, 'market_value', 'asc').map(r => r.symbol), ['BBB', 'EEE', 'AAA', 'DDD', 'CCC'], 'clicking the header again reverses it')
assert.deepEqual(sortModule.build(rows, 'symbol', 'asc').map(r => r.symbol), ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'], 'other columns still sort')
assert.deepEqual(sortModule.build(rows, null, 'desc').map(r => r.symbol), ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'], 'no sort field keeps the API order')
assert.ok(dashboard.includes('const sortedHoldings'), 'marker used by test-analysis-panel-readability stays')

console.log('✓ Thai labels (calendar, discovery themes) and default holdings order regression tests passed')
