import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

async function importTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `${filePath} transpile diagnostics: ${errors.map(item => item.messageText).join('; ')}`)
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)
}

const { sanitizeWeek52, WEEK52_HIGH_MAX_RATIO, WEEK52_LOW_MAX_RATIO, WEEK52_BARS, week52FromBars, fillWeek52 } = await importTsModule('lib/week52.ts')
const { limitRows } = await importTsModule('lib/limit-rows.ts')

// ---------- 52-week range ----------
assert.equal(WEEK52_HIGH_MAX_RATIO, 25)
assert.equal(WEEK52_LOW_MAX_RATIO, 1.5)
const clean = (price, high, low) => sanitizeWeek52(price, high, low)

// EOSE on 2026-11-11: price 1.98, 52-week high 19.65 (9.9x) and low 1.59 is a real range after a crash and must be kept.
assert.deepEqual(clean(1.98, 19.65, 1.59), { week52High: 19.65, week52Low: 1.59 })
// A 90-95% crash (10-20x) is kept.
assert.deepEqual(clean(2, 40, 1.5), { week52High: 40, week52Low: 1.5 })
assert.deepEqual(clean(1, 20, 0.9), { week52High: 20, week52Low: 0.9 })
// Review of PR #164: an ADR whose whole range is in another scale (DKK ~7x, SEK ~10x, BRL ~5-6x, MXN ~18x) is dropped as a pair.
assert.deepEqual(clean(40, 40 * 7, 40 * 6), { week52High: null, week52Low: null }, 'DKK-like range')
assert.deepEqual(clean(40, 40 * 11, 40 * 6), { week52High: null, week52Low: null }, 'a range far above the price')
assert.deepEqual(clean(40, 40 * 18, 40 * 12), { week52High: null, week52Low: null }, 'MXN-like range')
// Round 2 of the review: the limit for the low is 1.5x the price, so a range whose low is only a few times the price is caught too.
assert.deepEqual(clean(50, 560, 231), { week52High: null, week52Low: null }, 'DKK range with the price 1.5x above its low')
assert.deepEqual(clean(20, 165, 82.5), { week52High: null, week52Low: null }, 'BRL-like range')
assert.deepEqual(clean(40, 600, 160), { week52High: null, week52Low: null }, 'SEK-like range')
assert.deepEqual(clean(50, 476, 285.6), { week52High: null, week52Low: null }, 'DKK range')
assert.deepEqual(clean(10, 252, 45), { week52High: null, week52Low: null }, 'MXN-like range: the low must not stay alone')
// A low exactly at 1.5x stays with its high, a hair above it drops the pair, and a missing high changes nothing for the low.
assert.deepEqual(clean(100, 900, 150), { week52High: 900, week52Low: 150 })
assert.deepEqual(clean(100, 900, 150.01), { week52High: null, week52Low: null })
assert.deepEqual(clean(100, null, 600), { week52High: null, week52Low: null }, 'a low far above the price is dropped even when the high is missing')
assert.deepEqual(clean(100, null, 150), { week52High: null, week52Low: 150 })
// A low slightly above the price (stale data) is normal and stays.
assert.deepEqual(clean(100, 300, 110), { week52High: 300, week52Low: 110 })
// A low that is too small does not touch the high.
assert.deepEqual(clean(100, 150, 4.99), { week52High: 150, week52Low: null }, 'a too small low is dropped alone')
// A USD quote with a THB high (about 33x) is a unit error and is dropped, the sane low stays.
assert.deepEqual(clean(40, 40 * 33.5, 35), { week52High: null, week52Low: 35 })
// The 25x limit itself: exactly 25x stays, just above it is dropped.
assert.equal(clean(10, 250, 5).week52High, 250)
assert.equal(clean(10, 250.01, 5).week52High, null)
// The low rules are unchanged: below 5% of the price or above 5x the price is dropped.
assert.equal(clean(100, 150, 4.99).week52Low, null)
assert.equal(clean(100, 150, 5).week52Low, 5)
assert.equal(clean(100, 900, 151).week52Low, null)
assert.equal(clean(100, 900, 150).week52Low, 150)
assert.equal(clean(100, 900, 151).week52High, null, 'the high goes with a low above 1.5x')
// Without a usable price nothing is judged and the values pass through.
for (const price of [null, 0, -3]) assert.deepEqual(clean(price, 999, 0.001), { week52High: 999, week52Low: 0.001 })
// Missing values stay missing.
assert.deepEqual(clean(50, null, null), { week52High: null, week52Low: null })
assert.deepEqual(clean(50, 80, null), { week52High: 80, week52Low: null })

// finnhub.ts uses the helper and no longer carries its own 5x rule.
const finnhub = fs.readFileSync('lib/finnhub.ts', 'utf8')
assert.match(finnhub, /import \{ sanitizeWeek52 \} from '@\/lib\/week52'/)
assert.match(finnhub, /sanitizeWeek52\(currentPrice, m\.week52High, m\.week52Low\)/)
assert.doesNotMatch(finnhub, /week52High > currentPrice \* 5/, 'the old 5x rule must not come back')

// ---------- 52-week range from price bars (v1.41.35) ----------
assert.equal(WEEK52_BARS, 252)
assert.deepEqual(week52FromBars([]), { week52High: null, week52Low: null })
assert.deepEqual(week52FromBars([{ high: 10.126, low: 9.994 }]), { week52High: 10.13, week52Low: 9.99 }, 'rounded to 2 decimals')
assert.deepEqual(week52FromBars([{ high: 12, low: 8 }, { high: 15, low: 9 }, { high: 11, low: 7 }]), { week52High: 15, week52Low: 7 })
// only the last 252 bars count: older extremes are outside the 52 weeks
const long = Array.from({ length: 300 }, (_, i) => ({ high: 50 + (i % 7), low: 40 + (i % 5) }))
long[10] = { high: 999, low: 1 }
long[47] = { high: 888, low: 2 }
assert.deepEqual(week52FromBars(long), { week52High: 56, week52Low: 40 }, 'bars before the last 252 are ignored')
// index 47 of 300 is the 253rd bar from the end (outside, ignored above); index 48 is the 252nd (inside)
long[48] = { high: 777, low: 3 }
assert.deepEqual(week52FromBars(long), { week52High: 777, week52Low: 3 }, 'the 252nd bar from the end is inside')
// same result as the inline code it replaced (lib/indicators.ts calcWeek52Range) on seeded random bars
const reference = bars => {
  if (!bars.length) return { week52High: null, week52Low: null }
  const recent = bars.slice(-252)
  const r2 = n => Math.round(n * 100) / 100
  return { week52High: r2(Math.max(...recent.map(b => b.high))), week52Low: r2(Math.min(...recent.map(b => b.low))) }
}
let seed = 12345
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
for (const n of [0, 1, 2, 50, 251, 252, 253, 400]) {
  const bars = Array.from({ length: n }, () => { const base = 1 + rnd() * 500; return { high: base * (1 + rnd() * 0.1), low: base * (1 - rnd() * 0.1) } })
  assert.deepEqual(week52FromBars(bars), reference(bars), `same as the old inline code for ${n} bars`)
}
const barsRange = { week52High: 70, week52Low: 40 }
const none = { week52High: null, week52Low: null }
// the provider wins; the bars only fill what is missing
assert.deepEqual(fillWeek52(50, { week52High: 80, week52Low: 45 }, barsRange), { week52High: 80, week52Low: 45 }, 'a complete provider range is untouched')
assert.deepEqual(fillWeek52(50, none, barsRange), { week52High: 70, week52Low: 40 }, 'both missing: both from the bars')
assert.deepEqual(fillWeek52(50, { week52High: 80, week52Low: null }, barsRange), { week52High: 80, week52Low: 40 }, 'only the low is filled')
assert.deepEqual(fillWeek52(50, { week52High: null, week52Low: 45 }, barsRange), { week52High: 70, week52Low: 45 }, 'only the high is filled')
assert.deepEqual(fillWeek52(50, none, null), none, 'no bars: stays empty')
assert.deepEqual(fillWeek52(50, { week52High: 80, week52Low: 45 }, null), { week52High: 80, week52Low: 45 }, 'no bars: provider values stay')
assert.deepEqual(fillWeek52(50, none, none), none, 'bars without values: stays empty')
// bars in another scale are dropped on their own and never take a good provider value with them
assert.deepEqual(fillWeek52(50, none, { week52High: 600, week52Low: 240 }), none, 'bar range far above the price is dropped')
assert.deepEqual(fillWeek52(50, { week52High: 80, week52Low: null }, { week52High: 600, week52Low: 240 }), { week52High: 80, week52Low: null }, 'the provider high survives a bad bar range')
assert.deepEqual(fillWeek52(50, { week52High: null, week52Low: 45 }, { week52High: 600, week52Low: 240 }), { week52High: null, week52Low: 45 }, 'the provider low survives a bad bar range')
// the merged range is checked once more: a provider value that does not fit a bar value from the other source
assert.deepEqual(fillWeek52(50, { week52High: null, week52Low: 80 }, barsRange), { week52High: null, week52Low: null }, 'a low far above the price still drops the pair')
// no usable price: nothing is judged
assert.deepEqual(fillWeek52(null, none, barsRange), { week52High: 70, week52Low: 40 })
assert.deepEqual(fillWeek52(0, none, barsRange), { week52High: 70, week52Low: 40 })

// indicators.ts and the prices route use the helpers
const indicators = fs.readFileSync('lib/indicators.ts', 'utf8')
assert.match(indicators, /import \{ week52FromBars \} from '@\/lib\/week52'/)
assert.match(indicators, /const range52 = week52FromBars\(bars\)/)
assert.doesNotMatch(indicators, /function calcWeek52Range/, 'the inline range code must not come back')
assert.match(indicators, /export async function getWeek52FromBars\(/)
const pricesRoute = fs.readFileSync('app/api/prices/route.ts', 'utf8')
assert.match(pricesRoute, /import \{ getWeek52FromBars \} from '@\/lib\/indicators'/)
assert.match(pricesRoute, /import \{ fillWeek52 \} from '@\/lib\/week52'/)
assert.match(pricesRoute, /const MAX_BARS_FILL = 5\r?\n/, 'at most 5 symbols per request are filled from the bars')
assert.match(pricesRoute, /const BARS_FILL_TIMEOUT_MS = 4000\r?\n/)
assert.match(pricesRoute, /\.slice\(0, MAX_BARS_FILL\)/)
assert.match(pricesRoute, /AbortSignal\.timeout\(BARS_FILL_TIMEOUT_MS\)/)
assert.match(pricesRoute, /Promise\.allSettled\(missing\.map/, 'one failed fetch must not fail the request')
assert.match(pricesRoute, /fillWeek52\(d\.price, \{ week52High: d\.week52High, week52Low: d\.week52Low \}, fromBars\[sym\] \?\? null\)/)
assert.match(pricesRoute, /\.filter\(\(\[, d\]\) => d\.week52High == null \|\| d\.week52Low == null\)/, 'only symbols with a missing value are fetched')
assert.doesNotMatch(fs.readFileSync('lib/finnhub.ts', 'utf8'), /getWeek52FromBars|fillWeek52/, 'the provider module is not changed by this feature')

// ---------- row limit ----------
const rows = Array.from({ length: 11 }, (_, i) => ({ assetKey: `A${i}` }))
assert.deepEqual(limitRows(rows, 20), { shown: rows, hidden: 0 }, 'all 11 allocation rows are shown')
const cut = limitRows(Array.from({ length: 25 }, (_, i) => i), 20)
assert.equal(cut.shown.length, 20)
assert.equal(cut.hidden, 5)
assert.deepEqual(limitRows([], 20), { shown: [], hidden: 0 })
assert.deepEqual(limitRows([1, 2, 3], 3), { shown: [1, 2, 3], hidden: 0 }, 'exactly at the limit hides nothing')
assert.deepEqual(limitRows([1, 2, 3], 2), { shown: [1, 2], hidden: 1 })
assert.deepEqual(limitRows([1, 2, 3], 0), { shown: [], hidden: 3 })
assert.deepEqual(limitRows([1, 2, 3], -4), { shown: [], hidden: 3 }, 'a negative limit shows nothing and hides everything')
assert.deepEqual(limitRows([1, 2, 3], -1), { shown: [], hidden: 3 }, 'a limit of -1 must not mean "all but the last"')
assert.deepEqual(limitRows([1, 2, 3], 2.9), { shown: [1, 2], hidden: 1 }, 'a fractional limit is floored')
assert.deepEqual(limitRows([1, 2, 3], Number.NaN), { shown: [1, 2, 3], hidden: 0 }, 'an invalid limit never hides rows')
const source = [1, 2, 3]
limitRows(source, 1)
assert.deepEqual(source, [1, 2, 3], 'the input list is not changed')

// ---------- Command Center component ----------
const component = fs.readFileSync('components/portfolio/InvestmentCommandCenter.tsx', 'utf8')
assert.match(component, /import \{ CURRENT_VERSION \} from '@\/config\/changelog'/)
assert.match(component, /Personal Investment Command Center · \{CURRENT_VERSION\}/)
assert.doesNotMatch(component, /v1\.\d+\.\d+ RC/, 'the version label must not be hard-coded')
assert.match(component, /limitRows\(allocationRows, ALLOCATION_ROW_LIMIT\)/)
assert.doesNotMatch(component, /allocationRows\.slice\(/, 'allocation rows must not be cut silently')
assert.match(component, /const allocationRows = snapshot\.sections\.allocations\.data \?\? \[\]\r?\n/, 'the allocation rows are taken whole from the snapshot')
assert.match(component, /const ALLOCATION_ROW_LIMIT = 20\r?\n/, 'the Command Center shows up to 20 allocation targets (the old 8 hid SPCX and DIME)')
assert.match(component, /\{allocationView\.shown\.map\(row => /, 'the card renders the limited list')
assert.doesNotMatch(component, /allocationView\.shown\.slice\(/, 'the limited list must not be cut again')
assert.match(component, /\{allocationView\.hidden > 0 && <li [^>]*>และอีก \{allocationView\.hidden\} รายการ/, 'the hidden-count line shows only when rows are hidden')
assert.doesNotMatch(component, /allocationView\.hidden >= 0/, 'never show "and 0 more"')

console.log('✓ 52-week range check, row limit and Command Center label regression tests passed')
