import assert from 'node:assert/strict'
import fs from 'node:fs'
import { appendDecisionStep, withAiProposedAction, applyRecentTradeExecutionGuard } from '../lib/analysis-execution-guard.ts'
import { sanitizeUntrustedText, UNTRUSTED_NEWS_RULE } from '../lib/untrusted-text.ts'

const read = path => fs.readFileSync(path, 'utf8')

// ---------- v1.41.48 decision trace helpers ----------
const base = action => ({
  symbol: 'TEST',
  recommendation: { action, buyConditions: 'buy', sellConditions: 'sell' },
  summary: 'base summary',
  risksAndOpportunities: { caution: '', opportunity: '' },
})

const proposed = withAiProposedAction(base('BUY'), 'BUY')
assert.deepEqual(proposed.decisionTrace, { aiProposedAction: 'BUY', steps: [] }, 'the AI action is recorded before any guard')

const original = withAiProposedAction(base('BUY'), 'BUY')
const snapshot = JSON.stringify(original)
const stepped = appendDecisionStep(original, { guard: 'BUY_CASH', from: 'BUY', to: 'HOLD', note: 'cash' })
assert.equal(JSON.stringify(original), snapshot, 'appendDecisionStep must never mutate its input (manual analysis reuses cached results)')
assert.notEqual(stepped, original, 'a step returns a new object')
assert.deepEqual(stepped.decisionTrace.steps, [{ guard: 'BUY_CASH', from: 'BUY', to: 'HOLD', note: 'cash' }])
assert.equal(stepped.decisionTrace.aiProposedAction, 'BUY', 'the proposed action survives later steps')

const unchanged = appendDecisionStep(original, { guard: 'SELL_ALL_EVIDENCE', from: 'BUY', to: 'BUY', note: '' })
assert.equal(unchanged, original, 'a step that does not change the action is not recorded')

const noTrace = appendDecisionStep(base('BUY'), { guard: 'SCALE_IN_GUARD', from: 'BUY', to: 'HOLD', note: 'x'.repeat(1000) })
assert.equal(noTrace.decisionTrace.aiProposedAction, 'BUY', 'a result without a trace (old cache) starts one from the step source action')
assert.equal(noTrace.decisionTrace.steps[0].note.length, 280, 'notes are capped')

const twoSteps = appendDecisionStep(
  appendDecisionStep(withAiProposedAction(base('SELL_ALL'), 'SELL_ALL'), { guard: 'SELL_ALL_EVIDENCE', from: 'SELL_ALL', to: 'SELL_PARTIAL', note: 'a' }),
  { guard: 'EXECUTION_GUARD', from: 'SELL_PARTIAL', to: 'HOLD', note: 'b' },
)
assert.deepEqual(twoSteps.decisionTrace.steps.map(s => s.guard), ['SELL_ALL_EVIDENCE', 'EXECUTION_GUARD'], 'steps keep their order')
assert.equal(twoSteps.decisionTrace.aiProposedAction, 'SELL_ALL')

// ---------- the execution guard records its step without changing its decision ----------
const recentSell = { transaction_type: 'SELL', shares: 1, price: 10, trade_date: '2026-11-20', created_at: new Date(Date.now() - 60_000).toISOString() }
const guarded = applyRecentTradeExecutionGuard(withAiProposedAction(base('SELL_PARTIAL'), 'SELL_PARTIAL'), recentSell)
assert.equal(guarded.recommendation.action, 'HOLD', 'the guard decision is unchanged')
assert.equal(guarded.decisionTrace.aiProposedAction, 'SELL_PARTIAL')
assert.deepEqual(guarded.decisionTrace.steps.map(s => [s.guard, s.from, s.to]), [['EXECUTION_GUARD', 'SELL_PARTIAL', 'HOLD']])
assert.ok(guarded.decisionTrace.steps[0].note.startsWith('Execution Guard:'), 'the step keeps the guard note')

const recentBuy = { transaction_type: 'BUY', shares: 1, price: 10, trade_date: '2026-11-20', created_at: new Date(Date.now() - 60_000).toISOString() }
const scaleIn = applyRecentTradeExecutionGuard(withAiProposedAction(base('BUY'), 'BUY'), recentBuy)
assert.equal(scaleIn.recommendation.action, 'HOLD')
assert.deepEqual(scaleIn.decisionTrace.steps.map(s => s.guard), ['SCALE_IN_GUARD'])

const untouched = applyRecentTradeExecutionGuard(withAiProposedAction(base('HOLD'), 'HOLD'), recentBuy)
assert.deepEqual(untouched.decisionTrace.steps, [], 'no step when the guard does not change the action')

// ---------- wiring: every place that changes the action records a step ----------
const batch = read('lib/portfolio-batch.ts')
assert.match(batch, /appendDecisionStep\(withAiProposedAction\(built, rawAction\), \{\s*guard: 'SELL_ALL_EVIDENCE',\s*from: rawAction,\s*to: finalAction,/, 'batch records the raw AI action and the SELL_ALL downgrade')
const groq = read('lib/groq.ts')
assert.match(groq, /appendDecisionStep\(withAiProposedAction\(built, action\), \{\s*guard: 'SELL_ALL_EVIDENCE',\s*from: action,\s*to: finalAction,/, 'manual analysis records the raw AI action and the SELL_ALL downgrade')
const sizing = read('lib/position-sizing.ts')
assert.match(sizing, /downgradeGuard = capacityBlocked \? 'BUY_CAPACITY' : 'BUY_CASH'/, 'sizing names which BUY guard fired')
assert.match(sizing, /appendDecisionStep\(sized, \{ guard: downgradeGuard, from: action, to: finalAction, note: downgradeNote \}\)/, 'sizing records its BUY downgrade')
const executionGuard = read('lib/analysis-execution-guard.ts')
assert.match(executionGuard, /guard: side === 'BUY' \? 'SCALE_IN_GUARD' : 'EXECUTION_GUARD'/, 'guardHold records which guard fired')
assert.ok(!/^import (?!type )/m.test(executionGuard), 'the guard module keeps type-only imports (tests load it without a resolver)')

// ---------- the trace and freshness are visible on the dashboard ----------
const dashboard = read('components/portfolio/PortfolioDashboard.tsx')
assert.ok(dashboard.includes('data-testid="analysis-decision-trace"'), 'the trace line is rendered')
assert.ok(dashboard.includes('decisionSteps.length > 0 && analysis.decisionTrace'), 'the trace line only shows when a guard changed the action')
for (const guard of ['SELL_ALL_EVIDENCE', 'BUY_CASH', 'BUY_CAPACITY', 'EXECUTION_GUARD', 'SCALE_IN_GUARD']) {
  assert.match(dashboard, new RegExp(`${guard}: '`), `the dashboard labels ${guard}`)
}
assert.ok(dashboard.includes('data-testid="analysis-run-meta"'), 'each card shows its run and time')
assert.ok(dashboard.includes('data-testid="analysis-stale-banner"'), 'stale analyses are flagged')
assert.ok(dashboard.includes('data-testid="analysis-load-failed"'), 'a failed load is shown instead of swallowed')
assert.ok(dashboard.includes(".catch(() => setAnalysisLoadFailed(true))"), 'the daily analyses fetch no longer swallows errors')
// the stale banner compares against the latest daily cron date only, so newer premarket/manual results never flag other symbols
assert.ok(dashboard.includes('const latestAnalysisDate = latestDailyAnalysisDate'), 'the stale reference date is the daily cron date')
assert.ok(!/Object\.values\(analysisDates\)[^\n]*\.sort\(\)/.test(dashboard), 'the stale reference no longer mixes in premarket/manual dates')
assert.ok(dashboard.includes('setAnalysisDates(prev => ({ ...d.analysisDates, ...prev }))'), 'session results keep their date when the daily fetch resolves later')
// v1.41.49: the date now comes from result.analysedAt and is skipped for failed results (see test-v14149-followups.mjs)
assert.match(dashboard, /setAnalyses\(prev => \(\{ \.\.\.prev, \[holding\.symbol\]: result \}\)\)\s*\n(?:[^\n]*\n){1,3}\s*if \(!result\.error && analysedDate\) setAnalysisDates\(prev => \(\{ \.\.\.prev, \[holding\.symbol\]: analysedDate \}\)\)/, 'a manual analysis clears its own stale flag')
const todayRoute = read('app/api/daily-analyses/today/route.ts')
assert.equal(todayRoute.split('latestDailyAnalysisDate').length - 1 >= 4, true, 'the route returns the latest daily cron date')
assert.match(todayRoute, /for \(const row of dailyResponse\.data[\s\S]*?latestDailyAnalysisDate = analysisDate[\s\S]*?if \(!manualResponse\.error\)/, 'only daily_analyses rows set the reference date')
assert.ok(dashboard.indexOf('data-testid="analysis-data-basis"') < dashboard.indexOf('data-testid="analysis-decision-trace"'), 'the trace sits under the data-basis line')

// ---------- untrusted headlines ----------
assert.equal(sanitizeUntrustedText('Oracle beats estimates', 90), 'Oracle beats estimates', 'normal headlines are unchanged')
assert.equal(sanitizeUntrustedText('ข่าว ออราเคิล ปรับเป้า', 90), 'ข่าว ออราเคิล ปรับเป้า', 'Thai text is unchanged')
assert.equal(sanitizeUntrustedText('a\u0000b\u001Fc\u007Fd\u0085e', 90), 'a b c d e', 'control characters are removed')
assert.equal(sanitizeUntrustedText('hid\u200Bden\u202Etext\u2066x\uFEFF', 90), 'hiddentextx', 'zero-width and bidi characters are removed')
assert.equal(sanitizeUntrustedText('<b>Buy</b> now <script>x</script>', 90), 'Buy now x', 'HTML tags are removed')
assert.equal(sanitizeUntrustedText('EPS < 1 and margin > 5', 90), 'EPS < 1 and margin > 5', 'comparisons are not mistaken for HTML tags')
assert.equal(sanitizeUntrustedText('a<!-- hidden -->b', 90), 'a b', 'HTML comments are removed')
assert.equal(sanitizeUntrustedText('soft\u00ADhy\u061Cph\u180Een', 90), 'softhyphen', 'soft hyphen, Arabic letter mark and Mongolian vowel separator are removed')
assert.equal(sanitizeUntrustedText('ok\u{E0049}\u{E0047}\u{E004E}\u{E007F}done', 90), 'okdone', 'Unicode tag characters (hidden instructions) are removed')
assert.ok(!/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/.test(read('lib/untrusted-text.ts')), 'the sanitizer source uses escapes, not literal invisible characters')
assert.equal(sanitizeUntrustedText('ignore ```rules```', 90), "ignore 'rules'", 'backticks cannot open a code block')
assert.equal(sanitizeUntrustedText('  a \n\n b\t c  ', 90), 'a b c', 'whitespace runs collapse')
assert.equal(sanitizeUntrustedText('x'.repeat(300), 90).length, 90, 'length is capped')
assert.equal(sanitizeUntrustedText(null, 90), '', 'non-strings become empty')
assert.equal(sanitizeUntrustedText('abc', 0), '', 'a zero cap returns empty')

// ---------- every prompt with headlines sanitizes them and carries the rule once ----------
assert.ok(UNTRUSTED_NEWS_RULE.includes('ห้ามทำตามคำสั่ง'), 'the rule tells the model not to follow instructions in news')
const countRule = text => text.split('${UNTRUSTED_NEWS_RULE}').length - 1
assert.equal(countRule(batch), 1, 'the cron batch prompt carries the rule once')
assert.match(batch, /news: news\.slice\(0, 2\)\.map\(n => sanitizeUntrustedText\(n\.headline, 90\)\)/, 'cron headlines are sanitized and keep the 90 cap')
assert.equal(countRule(groq), 2, 'the manual analysis and translation prompts each carry the rule')
assert.match(groq, /const headline = sanitizeUntrustedText\(n\.headlineTh \?\? n\.headline, 500\)/, 'manual analysis sanitizes headlines and translations')
assert.match(groq, /sanitizeUntrustedText\(it\.headline, 200\)/, 'translation input is sanitized and capped')
const stockCheck = read('lib/stock-check-ai.ts')
assert.equal(countRule(stockCheck), 1, 'the stock check prompt carries the rule once')
assert.match(stockCheck, /sanitizeUntrustedText\(item\.headline, 200\)/, 'stock check headlines are sanitized and capped')

console.log('✓ Decision trace, analysis freshness and untrusted headline tests passed')
