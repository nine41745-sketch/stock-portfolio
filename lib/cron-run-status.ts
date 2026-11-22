// v1.41.50: บันทึกสถานะรอบ cron วิเคราะห์ (หนึ่งแถวต่อรอบ × ผู้ใช้/พอร์ต) ลงตาราง analysis_cron_runs
// แบบ best-effort: ถ้าบันทึกไม่ได้ (เช่นยังไม่ได้รัน migration) แค่ log แล้วปล่อยให้ cron ทำงานต่อ ไม่ทำให้การวิเคราะห์ล้ม
// ไฟล์นี้ไม่มี import เพื่อให้เทสต์โหลดได้โดยตรง

export type CronRunMode = 'DAILY_POST_CLOSE' | 'PREMARKET_TRIGGER'
export type CronRunStatus = 'ok' | 'partial' | 'failed' | 'rate_limited' | 'no_work'

export const CRON_RUN_ERROR_SUMMARY_MAX_CHARS = 500
const CRON_RUN_ERROR_ITEMS_MAX = 5

export interface CronRunCounts {
  processed: number
  failed: number
  rateLimited: number
}

export interface CronRunRow {
  user_id: string
  portfolio_id?: string
  mode: CronRunMode
  run_date: string
  started_at: string
  finished_at: string
  status: CronRunStatus
  holdings: number | null
  processed: number
  failed: number
  rate_limited: number
  error_summary: string | null
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)

export function deriveCronRunStatus(counts: CronRunCounts): CronRunStatus {
  const processed = count(counts.processed)
  const failed = count(counts.failed)
  const rateLimited = count(counts.rateLimited)
  if (failed === 0 && rateLimited === 0) return processed > 0 ? 'ok' : 'no_work'
  if (processed > 0) return 'partial'
  return failed === 0 ? 'rate_limited' : 'failed'
}

export function summarizeCronErrors(errors: unknown): string | null {
  if (!Array.isArray(errors)) return null
  const items = errors
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.replace(/\s+/g, ' ').trim())
  if (items.length === 0) return null
  const shown = items.slice(0, CRON_RUN_ERROR_ITEMS_MAX).join(' | ')
  const more = items.length > CRON_RUN_ERROR_ITEMS_MAX ? ` (+${items.length - CRON_RUN_ERROR_ITEMS_MAX} more)` : ''
  return `${shown}${more}`.slice(0, CRON_RUN_ERROR_SUMMARY_MAX_CHARS)
}

// วันที่ไทย (YYYY-MM-DD) แบบเดียวกับ analysis_date ของ cron รายวัน
export function thaiDateString(timestampMs: number): string {
  return new Date(timestampMs + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function buildCronRunRow(input: {
  userId: string
  portfolioId: string | null
  mode: CronRunMode
  runDate: string
  startedAt: string
  finishedAt: string
  holdings?: number | null
  processed: number
  failed: number
  rateLimited: number
  errors?: unknown
}): CronRunRow {
  const counts = { processed: count(input.processed), failed: count(input.failed), rateLimited: count(input.rateLimited) }
  return {
    user_id: input.userId,
    ...(input.portfolioId ? { portfolio_id: input.portfolioId } : {}),
    mode: input.mode,
    run_date: input.runDate,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    status: deriveCronRunStatus(counts),
    holdings: input.holdings == null ? null : count(input.holdings),
    processed: counts.processed,
    failed: counts.failed,
    rate_limited: counts.rateLimited,
    error_summary: summarizeCronErrors(input.errors),
  }
}

// client ขั้นต่ำที่ต้องใช้ (service client ของ cron) เพื่อไม่ต้อง import supabase ในไฟล์นี้
interface CronRunInsertClient {
  from(table: string): { insert(rows: CronRunRow[]): PromiseLike<{ error: { message: string } | null }> }
}

export async function recordCronRuns(client: CronRunInsertClient, rows: CronRunRow[]): Promise<boolean> {
  if (rows.length === 0) return true
  try {
    const { error } = await client.from('analysis_cron_runs').insert(rows)
    if (error) {
      console.warn('[cron-run-status] not recorded (best-effort):', error.message)
      return false
    }
    return true
  } catch (error) {
    console.warn('[cron-run-status] not recorded (best-effort):', error instanceof Error ? error.message : String(error))
    return false
  }
}
