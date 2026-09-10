import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

async function importTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
      strict: true,
    },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${filePath} transpile diagnostics: ${errors.map(e => e.messageText).join('; ')}`)
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
}

const alerts = await importTsModule('lib/alerts.ts')
const calendar = await importTsModule('lib/market-calendar.ts')

const items = alerts.buildAlerts([
  {
    symbol: 'aaa',
    price: 98,
    support: 99,
    resistance: 110,
    volumeRatio: 1,
    stopLoss: 100,
    target1: 120,
    target2: 130,
    earnings: { date: '2026-09-11', daysUntil: 1, hour: 'bmo' },
  },
  {
    symbol: 'bbb',
    price: 121,
    support: 100,
    resistance: 120,
    volumeRatio: 1.3,
    stopLoss: 90,
    target1: 115,
    target2: 120,
    earnings: null,
  },
  {
    symbol: 'ccc',
    price: 101,
    support: 100,
    resistance: 110,
    volumeRatio: null,
    stopLoss: 100,
    target1: null,
    target2: null,
    earnings: null,
  },
])

assert.equal(items[0].severity, 'CRITICAL', 'Critical alerts must sort first')
assert.ok(items.some(item => item.symbol === 'AAA' && item.kind === 'STOP' && item.title === 'ถึง/หลุด Stop'))
assert.ok(items.some(item => item.symbol === 'AAA' && item.kind === 'NEAR_SUPPORT' && item.title === 'หลุดแนวรับ'))
assert.ok(items.some(item => item.symbol === 'AAA' && item.kind === 'EARNINGS' && item.severity === 'WARNING'))
assert.ok(items.some(item => item.symbol === 'BBB' && item.kind === 'TARGET' && item.title === 'ถึง Target 2'))
assert.ok(items.some(item => item.symbol === 'BBB' && item.kind === 'BREAKOUT' && item.title === 'Breakout + Volume'))
assert.ok(items.some(item => item.symbol === 'CCC' && item.kind === 'STOP' && item.title === 'ใกล้ Stop'))
assert.ok(items.some(item => item.symbol === 'CCC' && item.kind === 'NEAR_SUPPORT' && item.title === 'ใกล้แนวรับ'))

const summary = alerts.summarizeAlerts(items)
assert.equal(summary.total, items.length)
assert.ok(summary.critical >= 2)
assert.ok(summary.warning >= 1)
assert.ok(summary.info >= 2)

const macros = calendar.getMacroEvents('2026-09-10', 40)
assert.ok(macros.some(event => event.type === 'CPI' && event.date === '2026-09-11'))
assert.ok(macros.some(event => event.type === 'FOMC' && event.date === '2026-09-15'))
assert.ok(macros.some(event => event.type === 'CPI' && event.date === '2026-10-14'))
assert.equal(calendar.daysBetween('2026-09-10', '2026-09-11'), 1)

const earningsEvent = calendar.makeEarningsEvent('nvda', { date: '2026-11-18', daysUntil: 20, hour: 'amc' })
assert.equal(earningsEvent.symbol, 'NVDA')
assert.equal(earningsEvent.timing, 'After market close')

for (const path of [
  'lib/alerts.ts',
  'lib/alerts-data.ts',
  'lib/market-calendar.ts',
  'app/api/alerts/route.ts',
  'app/api/calendar/route.ts',
  'app/alerts/page.tsx',
  'app/alerts/error.tsx',
  'app/calendar/page.tsx',
  'app/calendar/error.tsx',
  'components/portfolio/AlertsCenter.tsx',
  'components/portfolio/MarketCalendar.tsx',
]) assert.equal(fs.existsSync(path), true, `${path} is required`)

const dataLoader = fs.readFileSync('lib/alerts-data.ts', 'utf8')
assert.match(dataLoader, /get_decrypted_holdings/, 'Alerts must track real Holdings')
assert.match(dataLoader, /get_decrypted_trade_plans/, 'Alerts must use active Trade Plan levels')
assert.match(dataLoader, /getMultipleQuotes/, 'Alerts must use current prices')
assert.match(dataLoader, /getTechnicalIndicators/, 'Support/Resistance alerts must use technical data')
assert.match(dataLoader, /getUpcomingEarnings/, 'Earnings alerts must use Finnhub calendar')
assert.doesNotMatch(dataLoader, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/, 'Alerts/Calendar loader must remain read-only')

const alertsUi = fs.readFileSync('components/portfolio/AlertsCenter.tsx', 'utf8')
assert.match(alertsUi, /🔔 Notification Center/)
assert.match(alertsUi, /Stop \/ Target \/ Near Support \/ Breakout \/ Earnings/)
assert.match(alertsUi, /Live Derived Alerts/)
assert.match(alertsUi, /ไม่สร้าง BUY\/SELL/)

const calendarUi = fs.readFileSync('components/portfolio/MarketCalendar.tsx', 'utf8')
assert.match(calendarUi, /📅 Market Calendar/)
assert.match(calendarUi, /Earnings ของหุ้นที่ติดตาม \+ US CPI \+ FOMC/)
assert.match(calendarUi, /Source:/)
assert.match(calendarUi, /read-only/)

const nav = fs.readFileSync('components/navigation/AppTabs.tsx', 'utf8')
assert.match(nav, /PLAN_SUBTABS/, 'Alerts and Calendar should remain nested under Plan')
assert.match(nav, /href: '\/alerts'/)
assert.match(nav, /href: '\/calendar'/)
const mainTabsSection = nav.split('const PLAN_SUBTABS')[0]
assert.equal((mainTabsSection.match(/href: '\/(dashboard|scanner|transactions|performance|trade-plan|risk)'/g) ?? []).length, 6, 'Keep six main tabs')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
assert.equal(pkg.version, '1.25.0', 'Final Preview must use finalized v1.25.0 metadata')
assert.match(pkg.scripts['test:critical'], /test-alerts-calendar\.mjs/, 'Alerts/Calendar regression must be part of critical build gate')

console.log('✓ Alerts + Calendar regression tests passed')
