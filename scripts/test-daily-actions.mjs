import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildActionPlan, buildActionRow, parsePlanText, PLAN_GROUP_ORDER } from '../lib/action-plan.ts'
import { applyRecentTradeExecutionGuard } from '../lib/analysis-execution-guard.ts'

const read = file => fs.readFileSync(file, 'utf8')

// ---------- plan text parser (results saved before v1.41.51 only have text) ----------
assert.deepEqual(parsePlanText('ช้อนเพิ่ม 15% (~12.5 หุ้น) — ซื้อเมื่อย่อ'), { label: 'ช้อนเพิ่ม', pct: 15, shares: 12.5 })
assert.deepEqual(parsePlanText('ขายทำกำไร 20% (~1,234.5 หุ้น)'), { label: 'ขายทำกำไร', pct: 20, shares: 1234.5 }, 'thousands separators are removed')
assert.deepEqual(parsePlanText('ลดพอร์ต 10% (~3 หุ้น) — รอเด้ง'), { label: 'ลดพอร์ต', pct: 10, shares: 3 })
assert.deepEqual(parsePlanText('ขายทั้งหมด 100% (~8 หุ้น)'), { label: 'ขายทั้งหมด', pct: 100, shares: 8 })
assert.equal(parsePlanText('ช้อนเพิ่ม: คำนวณ % จากจำนวนหุ้นเดิมไม่ได้ เพราะปัจจุบันถือ 0 หุ้น'), null, 'the zero-share explanation is not a plan')
assert.equal(parsePlanText('ขายทำกำไร 20% (~0 หุ้น)'), null, 'zero shares is not a plan')
assert.equal(parsePlanText(undefined), null)
assert.equal(parsePlanText('ถือต่อ'), null)

// ---------- position sizing now stores the numbers it already computed ----------
const sizingSource = read('lib/position-sizing.ts')
  .replace(/^import \{[^}]*\} from '@\/types'\r?\n/m, '')
  .replace("from '@/lib/analysis-execution-guard'", `from '${pathToFileURL(path.resolve('lib/analysis-execution-guard.ts')).href}'`)
assert.ok(!sizingSource.includes("'@/"), 'no unresolved alias remains in the sizing copy')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-actions-sizing-'))
const tmpFile = path.join(tmpDir, 'position-sizing.ts')
fs.writeFileSync(tmpFile, sizingSource)
const { applyPositionSizing } = await import(pathToFileURL(tmpFile).href)
fs.rmSync(tmpDir, { recursive: true, force: true })

const analysisFor = action => ({
  symbol: 'TEST',
  recommendation: { action, buyConditions: 'buy when pulling back', sellConditions: 'sell into strength' },
  summary: 'summary text',
  risksAndOpportunities: { caution: '', opportunity: '' },
  analysedAt: '2026-11-22T01:15:00.000Z',
  usedPrice: 100,
  decisionTrace: { aiProposedAction: action, steps: [] },
})
const holding = (overrides = {}) => ({ symbol: 'TEST', shares: 10, cost_basis: 100, current_price: 100, market_value: 1000, pnl_pct: 0, pe: null, week52High: null, week52Low: null, ...overrides })
const technical = { ema50: null, ema100: null, ema200: null, rsi14: null, atr14: null }

const buy = applyPositionSizing(analysisFor('BUY'), holding(), technical, 100000, 100000).result
assert.deepEqual(buy.sizing, { action: 'BUY', label: 'ช้อนเพิ่ม', pct: 15, shares: 1.5, price: 100, usd: 150 }, 'BUY keeps the fitted percent, shares and cash used')
assert.equal(buy.recommendation.action, 'BUY', 'sizing never changes the action')
const buyText = parsePlanText(buy.recommendation.buyConditions)
assert.ok(buyText && Math.abs(buyText.shares - buy.sizing.shares) < 1e-4 && buyText.pct === buy.sizing.pct, 'the stored text and the structured numbers agree')

const profit = applyPositionSizing(analysisFor('SELL_PARTIAL'), holding({ pnl_pct: 25 }), technical, 100000, 100000).result
assert.deepEqual(profit.sizing, { action: 'SELL_PARTIAL', label: 'ขายทำกำไร', pct: 20, shares: 2, price: 100, usd: 200 })
const loss = applyPositionSizing(analysisFor('SELL_PARTIAL'), holding({ pnl_pct: -10 }), technical, 100000, 100000).result
assert.deepEqual([loss.sizing.label, loss.sizing.pct, loss.sizing.shares], ['ลดพอร์ต', 10, 1], 'a losing position is labelled as a reduction, not profit taking')
const sellAll = applyPositionSizing(analysisFor('SELL_ALL'), holding(), technical, 100000, 100000).result
assert.deepEqual(sellAll.sizing, { action: 'SELL_ALL', label: 'ขายทั้งหมด', pct: 100, shares: 10, price: 100, usd: 1000 })
const hold = applyPositionSizing(analysisFor('HOLD'), holding(), technical, 100000, 100000).result
assert.equal(hold.sizing, undefined, 'HOLD has no buy/sell numbers')
const downgraded = applyPositionSizing(analysisFor('BUY'), holding(), technical, 1, 100000).result
assert.equal(downgraded.recommendation.action, 'HOLD')
assert.equal(downgraded.sizing, undefined, 'a BUY downgraded to HOLD keeps no buy numbers')
const noPrice = applyPositionSizing(analysisFor('SELL_ALL'), holding({ current_price: null, market_value: null }), technical, 100000, 100000).result
assert.deepEqual([noPrice.sizing.shares, noPrice.sizing.price, noPrice.sizing.usd], [10, null, null], 'without a price the shares stay but USD is not invented')

// ---------- the execution guard drops numbers when it changes the action ----------
const recentBuy = { transaction_type: 'BUY', shares: 1, price: 10, trade_date: '2026-11-22', created_at: new Date(Date.now() - 60_000).toISOString() }
const guarded = applyRecentTradeExecutionGuard(buy, recentBuy)
assert.equal(guarded.recommendation.action, 'HOLD', 'the guard decision is unchanged')
assert.equal(guarded.sizing, undefined, 'the stale buy numbers are cleared')
assert.ok(read('lib/analysis-execution-guard.ts').includes('sizing: undefined'), 'guardHold clears sizing')
assert.ok(!/^import (?!type )/m.test(read('lib/analysis-execution-guard.ts')), 'the guard module keeps type-only imports')

// ---------- rows ----------
const withText = (action, text, extra = {}) => ({
  ...analysisFor(action),
  recommendation: { action, buyConditions: action === 'BUY' ? text : '', sellConditions: action === 'BUY' ? '' : text },
  ...extra,
})
const structuredRow = buildActionRow('TEST', buy, '2026-11-22', false)
assert.deepEqual([structuredRow.group, structuredRow.label, structuredRow.shares, structuredRow.usd, structuredRow.numbersSource], ['BUY', 'ช้อนเพิ่ม', 1.5, 150, 'structured'])

const oldRow = buildActionRow('OLD', withText('SELL_PARTIAL', 'ขายทำกำไร 20% (~2.5 หุ้น) — แบ่งขาย', { usedPrice: 40.5 }), '2026-11-21', false)
assert.deepEqual([oldRow.label, oldRow.shares, oldRow.usd, oldRow.numbersSource], ['ขายทำกำไร', 2.5, 101.25, 'text'], 'old results are read from the plan text and priced at the analysis price')
const oldNoPrice = buildActionRow('OLD', withText('BUY', 'ช้อนเพิ่ม 10% (~1 หุ้น)', { usedPrice: null }), null, false)
assert.deepEqual([oldNoPrice.shares, oldNoPrice.usd], [1, null], 'no analysis price means no USD')
const oldNoNumbers = buildActionRow('OLD', withText('SELL_ALL', 'ขายตามแผน'), null, false)
assert.deepEqual([oldNoNumbers.group, oldNoNumbers.shares, oldNoNumbers.numbersSource, oldNoNumbers.planText], ['SELL_ALL', null, 'none', 'ขายตามแผน'], 'unreadable plans keep the original text and no numbers')

const mismatch = { ...withText('HOLD', ''), sizing: { action: 'BUY', label: 'ช้อนเพิ่ม', pct: 15, shares: 5, price: 100, usd: 500 } }
const mismatchRow = buildActionRow('TEST', mismatch, null, false)
assert.deepEqual([mismatchRow.group, mismatchRow.shares], ['HOLD', null], 'numbers for a different action are never shown')
const spoofed = buildActionRow('TEST', { ...withText('SELL_PARTIAL', 'ขายทำกำไร 10% (~1 หุ้น)'), sizing: { action: 'BUY', label: 'ช้อนเพิ่ม', pct: 15, shares: 5, price: 100, usd: 500 } }, null, false)
assert.deepEqual([spoofed.label, spoofed.shares, spoofed.numbersSource], ['ขายทำกำไร', 1, 'text'], 'a mismatched sizing falls back to the matching plan text')
assert.equal(buildActionRow('ERR', { ...analysisFor('BUY'), error: 'RATE_LIMIT' }, null, false).group, 'NO_RESULT', 'a failed analysis is not shown as advice')
assert.equal(buildActionRow('NONE', undefined, null, true).group, 'NO_RESULT')
const traced = buildActionRow('TRACE', { ...analysisFor('HOLD'), decisionTrace: { aiProposedAction: 'BUY', steps: [{ guard: 'SCALE_IN_GUARD', from: 'BUY', to: 'HOLD', note: 'n' }] } }, null, false)
assert.deepEqual([traced.aiProposedAction, traced.guardSteps.length], ['BUY', 1], 'the AI proposal and guard steps are carried to the row')

// ---------- whole plan ----------
const plan = buildActionPlan({
  analyses: {
    HOLDA: analysisFor('HOLD'),
    BUYB: { ...buy, symbol: 'BUYB' },
    BIGBUY: withText('BUY', 'ช้อนเพิ่ม 10% (~4 หุ้น)', { usedPrice: 50 }),
    SELLP: withText('SELL_PARTIAL', 'ขายทำกำไร 20% (~2 หุ้น)', { usedPrice: 30, analysedAt: '2026-11-22T03:00:00.000Z' }),
    SELLALL: withText('SELL_ALL', 'ขายทั้งหมด 100% (~5 หุ้น)', { usedPrice: 20 }),
    NONUM: withText('SELL_PARTIAL', 'ขายบางส่วน'),
    SOLD: analysisFor('BUY'),
  },
  analysisDates: { HOLDA: '2026-11-22' },
  staleSymbols: ['holda'],
  heldSymbols: ['HOLDA', 'bigbuy', 'BUYB', 'SELLP', 'SELLALL', 'NONUM', 'NEWCO'],
})
assert.deepEqual(plan.rows.map(row => row.symbol), ['SELLALL', 'SELLP', 'NONUM', 'BIGBUY', 'BUYB', 'HOLDA', 'NEWCO'], 'urgent actions first, larger amounts first inside a group, missing results last; sold symbols are dropped')
assert.deepEqual(plan.rows.map(row => row.group), ['SELL_ALL', 'SELL_PARTIAL', 'SELL_PARTIAL', 'BUY', 'BUY', 'HOLD', 'NO_RESULT'])
assert.equal(plan.rows.find(row => row.symbol === 'HOLDA').stale, true, 'stale flags match symbols case-insensitively')
assert.equal(plan.rows.find(row => row.symbol === 'SOLD'), undefined, 'a symbol that is not held is not listed')
assert.deepEqual(plan.totals.counts, { SELL_ALL: 1, SELL_PARTIAL: 2, BUY: 2, HOLD: 1, NO_RESULT: 1 })
assert.equal(plan.totals.buyUsd, 350, 'buy total adds the structured 150 and the text-based 4 x 50')
assert.equal(plan.totals.sellUsd, 160, 'sell total adds 5 x 20 and 2 x 30; rows without numbers are not guessed')
assert.equal(plan.totals.missingNumbers, 1, 'rows that need an order but have no numbers are counted')
assert.equal(plan.totals.latestAnalysedAt, '2026-11-22T03:00:00.000Z', 'the latest analysis time is reported')
assert.deepEqual(PLAN_GROUP_ORDER, ['SELL_ALL', 'SELL_PARTIAL', 'BUY', 'HOLD', 'NO_RESULT'])
const fallbackPlan = buildActionPlan({ analyses: { AAA: analysisFor('HOLD') } })
assert.deepEqual(fallbackPlan.rows.map(row => row.symbol), ['AAA'], 'without a held list the analysed symbols are used')
assert.deepEqual(buildActionPlan({ analyses: {}, heldSymbols: [] }).rows, [])

// ---------- review fixes (PR #208) ----------
const recentSell = { transaction_type: 'SELL', shares: 1, price: 10, trade_date: '2026-11-22', created_at: new Date(Date.now() - 60_000).toISOString() }
const sellGuarded = applyRecentTradeExecutionGuard(profit, recentSell)
assert.equal(sellGuarded.recommendation.action, 'HOLD', 'a recent sell turns a partial sell into HOLD')
assert.equal(sellGuarded.sizing, undefined, 'the execution guard clears the sell numbers too')
const noShares = applyPositionSizing(analysisFor('BUY'), holding({ shares: 0, market_value: 0 }), technical, 100000, 100000).result
assert.equal(noShares.sizing, undefined, 'a BUY on a zero-share holding has no percentage-based numbers')
const buyNoPrice = applyPositionSizing(analysisFor('BUY'), holding({ current_price: null, market_value: null }), technical, 100000, 100000).result
assert.deepEqual([buyNoPrice.sizing?.shares, buyNoPrice.sizing?.price, buyNoPrice.sizing?.usd], [1.5, null, null], 'a BUY without a price keeps the share count but no USD')

const labelMismatch = buildActionRow('TEST', withText('BUY', 'ขายทั้งหมด 100% (~9 หุ้น)', { usedPrice: 10 }), null, false)
assert.deepEqual([labelMismatch.group, labelMismatch.shares, labelMismatch.usd, labelMismatch.numbersSource], ['BUY', null, null, 'none'], 'plan text whose label belongs to another action is ignored, not added to the totals')
assert.equal(buildActionRow('TEST', withText('SELL_PARTIAL', 'ลดพอร์ต 10% (~2 หุ้น)', { usedPrice: 10 }), null, false).shares, 2, 'both partial-sell labels are accepted')
const tinyStructured = buildActionRow('TEST', { ...analysisFor('BUY'), sizing: { ...buy.sizing, shares: 0.00001, usd: 0 } }, null, false)
assert.equal(tinyStructured.shares, null, 'a share count that rounds to zero is not shown as an order')
assert.equal(buildActionRow('TEST', analysisFor('BUY'), null, false).mode, null, 'results from /api/analyze carry no analysisMode')

// ---------- wiring ----------
const todayRoute = read('app/api/daily-analyses/today/route.ts')
assert.equal(todayRoute.split('heldSymbols').length - 1, 2, 'the route returns the held symbols in both responses')
assert.ok(todayRoute.includes('heldSymbols: [...activeSymbols].sort()'))
assert.ok(!/createServiceClient/.test(todayRoute), 'the route still never uses the service role')

const tabs = read('components/navigation/AppTabs.tsx')
assert.ok(tabs.includes("{ href: '/daily-actions', label: 'คำแนะนำวันนี้'"), 'the nav has the new tab')
const page = read('app/daily-actions/page.tsx')
assert.ok(page.includes('<AppTabs />') && page.includes('<InactivityPinLock />') && page.includes('<DailyActionsWorkspace />'), 'the page has the nav and the inactivity lock')
assert.ok(page.includes("redirect('/login')") && page.includes('resolveActivePortfolio'), 'the page requires a login and an active portfolio')

const workspace = read('components/portfolio/DailyActionsWorkspace.tsx')
assert.equal(workspace.split("fetch('/api/analyze'").length - 1, 1, 'only the re-analyse button calls the analysis API')
assert.ok(workspace.indexOf("fetch('/api/analyze'") > workspace.indexOf('async function reanalyzeAll()'), 'the analysis API is only called from the button handler, never on load')
// v1.41.53: window.confirm is silently blocked in embedded browsers (the click looked like it did nothing), so the confirmation is in the page
assert.ok(!workspace.includes('window.confirm('), 'the confirmation must not depend on a native dialog')
assert.ok(workspace.includes('onClick={() => setConfirming(true)}') && workspace.includes('|| confirming ||'), 'the header button only opens the in-page confirmation')
assert.equal((workspace.match(/\breanalyzeAll\b/g) ?? []).length, 2, 'the analysis function is defined once and referenced from exactly one place (no effect, no direct onClick)')
assert.equal(workspace.split('void reanalyzeAll()').length - 1, 1, 'that one reference is the confirm button handler')
assert.ok(workspace.indexOf('void reanalyzeAll()') > workspace.indexOf('data-testid="daily-actions-confirm"'), 'that place is the confirm button inside the confirmation panel')
assert.ok(workspace.includes('data-testid="daily-actions-confirm-yes"') && workspace.includes('data-testid="daily-actions-confirm-no"') && workspace.includes('onClick={() => setConfirming(false)}'), 'the confirmation can be accepted or cancelled')
assert.ok(workspace.includes('role="alertdialog"') && workspace.includes('จะใช้โควตา AI'), 'the confirmation tells the user it consumes AI quota')
assert.ok(workspace.includes('autoFocus onClick={() => setConfirming(false)}'), 'keyboard focus starts on the safe button (cancel), not on the quota-consuming one')
assert.ok(workspace.includes("event.key === 'Escape'") && workspace.includes('reanalyzeButtonRef.current?.focus()'), 'Escape cancels and focus returns to the main button')
assert.ok(workspace.indexOf('setConfirming(false)') < workspace.indexOf("fetch('/api/analyze'"), 'the panel closes as soon as the run starts')
assert.ok(workspace.includes("(row.mode === null || row.mode === 'MANUAL')"), 'the shared-cash warning also covers results without an analysisMode (what /api/analyze returns)')
assert.ok(workspace.includes('data-testid="daily-actions-stale-totals"') && workspace.includes('staleOrderCount'), 'totals say how many rows are stale')
assert.ok(workspace.includes('if (symbols.length === 0 || runningRef.current) return') && workspace.includes('runningRef.current = false'), 'a ref guards against overlapping runs')
assert.ok(/for \(let i = 0; i < symbols\.length; i\+\+\) \{\s*\/\/[^\n]*\n\s*if \(!mounted\.current\) return/.test(workspace), 'leaving the page stops the run before the next request')
assert.ok(workspace.includes('response.status === 401 || response.status === 403') && workspace.includes('sessionExpired = true; break'), 'an expired session stops the run')
assert.ok(/for \(let i = 0; i < symbols\.length; i\+\+\)/.test(workspace) && workspace.includes("result.error === 'RATE_LIMIT'"), 'holdings are analysed one at a time and stop when the AI quota is full')
assert.ok(workspace.includes('buildActionPlan({'), 'the page uses the shared plan builder')
assert.ok(workspace.includes('ไม่ใช่คำสั่งซื้อขาย และไม่ใช่คำแนะนำการลงทุน'), 'the page carries the not-advice notice')
for (const id of ['daily-actions-workspace', 'daily-actions-summary', 'daily-actions-reanalyze', 'daily-action-time', 'daily-action-numbers', 'daily-action-trace', 'daily-action-stale', 'daily-actions-cron-banner', 'daily-actions-load-failed']) {
  assert.ok(workspace.includes(`data-testid="${id}"`) || workspace.includes(`data-testid={\`${id}`), `the page exposes ${id}`)
}

// ---------- the portfolio page has no per-holding AI button any more ----------
const dashboard = read('components/portfolio/PortfolioDashboard.tsx')
assert.ok(!dashboard.includes("fetch('/api/analyze'"), 'the portfolio page no longer starts an analysis')
assert.ok(!dashboard.includes('handleAnalyze') && !dashboard.includes('loadingSymbol'), 'the analysis handler and its loading state are gone')
assert.ok(!dashboard.includes('วิเคราะห์ AI') || !/>\s*[^<]*วิเคราะห์ AI/.test(dashboard.replace(/\/\/.*$/gm, '')), 'no button is labelled วิเคราะห์ AI')
assert.ok(!dashboard.includes('ลองวิเคราะห์อีกครั้ง') && !dashboard.includes('↻ วิเคราะห์ใหม่'), 'the retry buttons are gone')
assert.ok(dashboard.includes('data-testid="holding-latest-action"') && dashboard.includes('data-testid="holding-no-analysis"'), 'each holding shows its latest result read-only')
assert.ok(dashboard.includes('analysis && expandedAnalysisSymbol === h.symbol'), 'the saved analysis card can still be opened')
assert.equal(dashboard.split('href="/daily-actions"').length - 1 >= 3, true, 'the removed button points to the new page')

console.log('✓ Daily actions tests passed (structured sizing, plan builder, page wiring, no AI button on the portfolio page)')
