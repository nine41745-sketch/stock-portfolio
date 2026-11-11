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

const { sanitizeWeek52, WEEK52_HIGH_MAX_RATIO, WEEK52_LOW_MAX_RATIO } = await importTsModule('lib/week52.ts')
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
