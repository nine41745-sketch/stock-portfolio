import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildCronRunRow,
  CRON_RUN_ERROR_SUMMARY_MAX_CHARS,
  deriveCronRunStatus,
  recordCronRuns,
  summarizeCronErrors,
  thaiDateString,
} from '../lib/cron-run-status.ts'

const read = file => fs.readFileSync(file, 'utf8')

// ---------- status derivation ----------
assert.equal(deriveCronRunStatus({ processed: 3, failed: 0, rateLimited: 0 }), 'ok')
assert.equal(deriveCronRunStatus({ processed: 0, failed: 0, rateLimited: 0 }), 'no_work', 'nothing to analyse is not a failure')
assert.equal(deriveCronRunStatus({ processed: 2, failed: 1, rateLimited: 0 }), 'partial')
assert.equal(deriveCronRunStatus({ processed: 2, failed: 0, rateLimited: 1 }), 'partial')
assert.equal(deriveCronRunStatus({ processed: 0, failed: 0, rateLimited: 4 }), 'rate_limited')
assert.equal(deriveCronRunStatus({ processed: 0, failed: 2, rateLimited: 2 }), 'failed')
assert.equal(deriveCronRunStatus({ processed: NaN, failed: -1, rateLimited: undefined }), 'no_work', 'invalid counts are treated as zero')

// ---------- error summary ----------
assert.equal(summarizeCronErrors([]), null)
assert.equal(summarizeCronErrors(undefined), null)
assert.equal(summarizeCronErrors(['  a\n b ', '', 7, 'c']), 'a b | c', 'non-strings and blanks are dropped and whitespace collapses')
const many = summarizeCronErrors(['1', '2', '3', '4', '5', '6', '7'])
assert.equal(many, '1 | 2 | 3 | 4 | 5 (+2 more)', 'at most five errors are listed')
assert.equal(summarizeCronErrors(['x'.repeat(2000)]).length, CRON_RUN_ERROR_SUMMARY_MAX_CHARS, 'the summary fits the 500-char column check')

// ---------- Thai date ----------
assert.equal(thaiDateString(Date.parse('2026-11-21T16:59:59Z')), '2026-11-21')
assert.equal(thaiDateString(Date.parse('2026-11-21T17:00:00Z')), '2026-11-22')

// ---------- row building ----------
const row = buildCronRunRow({
  userId: 'u1', portfolioId: 'p1', mode: 'DAILY_POST_CLOSE', runDate: '2026-11-22',
  startedAt: '2026-11-22T01:15:00.000Z', finishedAt: '2026-11-22T01:16:00.000Z',
  holdings: null, processed: 5, failed: 1, rateLimited: 0, errors: ['TEST: missing'],
})
assert.deepEqual(row, {
  user_id: 'u1', portfolio_id: 'p1', mode: 'DAILY_POST_CLOSE', run_date: '2026-11-22',
  started_at: '2026-11-22T01:15:00.000Z', finished_at: '2026-11-22T01:16:00.000Z',
  status: 'partial', holdings: null, processed: 5, failed: 1, rate_limited: 0, error_summary: 'TEST: missing',
})
const legacy = buildCronRunRow({ userId: 'u1', portfolioId: null, mode: 'PREMARKET_TRIGGER', runDate: '2026-11-22', startedAt: 'a', finishedAt: 'b', holdings: 4, processed: 0, failed: 0, rateLimited: 0 })
assert.ok(!('portfolio_id' in legacy), 'legacy scopes omit portfolio_id (pre-v1.27.0 schema)')
assert.equal(legacy.holdings, 4)
assert.equal(legacy.status, 'no_work')

// ---------- best-effort recording never throws ----------
const inserted = []
assert.equal(await recordCronRuns({ from: table => ({ insert: async rows => { inserted.push([table, rows]); return { error: null } } }) }, [row]), true)
assert.deepEqual(inserted, [['analysis_cron_runs', [row]]], 'rows go to analysis_cron_runs in one insert')
const warn = console.warn
console.warn = () => {}
try {
  assert.equal(await recordCronRuns({ from: () => ({ insert: async () => ({ error: { message: 'relation "analysis_cron_runs" does not exist' } }) }) }, [row]), false, 'a missing table is reported, not thrown')
  assert.equal(await recordCronRuns({ from: () => { throw new Error('boom') } }, [row]), false, 'a thrown client error is swallowed')
} finally {
  console.warn = warn
}
let called = false
assert.equal(await recordCronRuns({ from: () => { called = true; return { insert: async () => ({ error: null }) } } }, []), true)
assert.equal(called, false, 'no insert when there is nothing to record')

// ---------- wiring in both cron routes (after the analysis, before the response) ----------
for (const [file, mode] of [['app/api/cron/daily-analyze/route.ts', 'DAILY_POST_CLOSE'], ['app/api/cron/premarket-analyze/route.ts', 'PREMARKET_TRIGGER']]) {
  const source = read(file)
  assert.ok(source.includes("import { buildCronRunRow, recordCronRuns"), `${file} imports the status helpers`)
  assert.ok(source.includes(`mode: '${mode}'`), `${file} records its own mode`)
  const record = source.indexOf('await recordCronRuns(supabase,')
  const response = source.lastIndexOf('return NextResponse.json({')
  assert.ok(record > 0 && record < response, `${file} records status right before returning the run summary`)
  assert.ok(source.indexOf('createServiceClient()') < record, `${file} records with the existing service client`)
  assert.equal(source.split('await recordCronRuns(').length - 1, 1, `${file} records once per run`)
}
const premarket = read('app/api/cron/premarket-analyze/route.ts')
assert.ok(premarket.includes("console.error('[premarket-cron] failed to list portfolio scopes:'"), 'premarket logs a failed scope listing')
assert.ok(premarket.includes('missing/invalid item in portfolio batch response'), 'premarket records a missing batch item instead of failing silently')
assert.ok(premarket.includes("console.error(`[premarket-cron] scope ${userId}/${portfolioId ?? 'legacy'} failed:`"), 'premarket logs a failed scope')

// ---------- dashboard reads the latest daily round with the user client ----------
const today = read('app/api/daily-analyses/today/route.ts')
assert.match(today, /from\('analysis_cron_runs'\)\s*\.select\('run_date, finished_at, status, processed, failed, rate_limited'\)\s*\.eq\('user_id', user\.id\)\s*\.eq\('mode', 'DAILY_POST_CLOSE'\)/, 'the route reads only the latest daily round for this user')
assert.ok(today.includes("if (portfolio.mode === 'portfolio') cronRunQuery = cronRunQuery.eq('portfolio_id', portfolio.portfolioId)"), 'the status is scoped to the active portfolio')
assert.ok(today.includes('const latestDailyCronRun = cronRunResponse.error ? null : cronRunResponse.data ?? null'), 'a missing table returns null instead of failing the analyses response')
assert.ok(!/createServiceClient/.test(today), 'the dashboard route never uses the service role')
const dashboard = read('components/portfolio/PortfolioDashboard.tsx')
assert.ok(dashboard.includes('data-testid="analysis-cron-run-banner"'), 'a failed or partial round is shown on the dashboard')
assert.ok(dashboard.includes("['failed', 'partial', 'rate_limited'].includes(latestDailyCronRun.status)"), 'ok and no_work rounds stay quiet')

// ---------- migration shape ----------
const migration = read('supabase/migration_analysis_cron_runs_v1.41.50.sql')
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.analysis_cron_runs/)
assert.match(migration, /ALTER TABLE public\.analysis_cron_runs ENABLE ROW LEVEL SECURITY/)
assert.match(migration, /CREATE POLICY analysis_cron_runs_select_own[\s\S]*FOR SELECT\s+TO authenticated[\s\S]*auth\.uid\(\) = user_id/, 'owners can only read their own rows')
assert.match(migration, /REVOKE ALL ON TABLE public\.analysis_cron_runs FROM PUBLIC, anon, authenticated;/)
assert.match(migration, /GRANT SELECT ON TABLE public\.analysis_cron_runs TO authenticated;/)
assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.analysis_cron_runs TO service_role;/)
assert.ok(!/GRANT[^;]*(UPDATE|DELETE)[^;]*analysis_cron_runs/.test(migration), 'no role may update or delete status rows')
assert.ok(!/\b(ALTER|DROP)\s+TABLE\s+(?!IF NOT EXISTS)public\.(?!analysis_cron_runs)/.test(migration), 'no existing table is altered or dropped')
assert.match(migration, /char_length\(error_summary\) <= 500/, 'the column check matches the helper cap')
for (const status of ['ok', 'partial', 'failed', 'rate_limited', 'no_work']) assert.ok(migration.includes(`'${status}'`), `the status check allows ${status}`)
const rollback = read('supabase/rollback_analysis_cron_runs_v1.41.50.sql')
assert.match(rollback, /DROP TABLE IF EXISTS public\.analysis_cron_runs;/)
assert.equal((rollback.match(/DROP /g) ?? []).length, 1, 'the rollback drops only the status table')
assert.ok(fs.existsSync('supabase/verify_analysis_cron_runs_v1.41.50.sql'), 'a read-only verifier ships with the migration')
assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/.test(read('supabase/verify_analysis_cron_runs_v1.41.50.sql').replace(/--.*$/gm, '').replace(/'[^']*'/g, '')), 'the verifier is read-only')

console.log('✓ Cron run status tests passed (status, error summary, best-effort recording, route wiring, migration shape)')
