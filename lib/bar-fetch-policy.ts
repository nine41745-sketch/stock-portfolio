// v1.41.57: เมื่อ bar รายวันล่าสุดช้ากว่า session ที่ควรจบแล้ว (เช่น Yahoo ยังไม่ส่งแถววันนั้นตอน cron รัน) ให้ดึงซ้ำสั้นๆ แล้วลองแหล่งสำรอง
// ไฟล์นี้ไม่มี import (ตั้งใจ) เพื่อให้เทสต์โหลดได้ตรงๆ และฉีดตัวดึงข้อมูล/นาฬิกา/sleep เข้ามาจำลองผู้ให้บริการได้โดยไม่ต้องรอ cron
//
// หลักการ:
// - ข้อมูลถูกอยู่แล้ว (lag = 0 หรือ lag ไม่ทราบ) → เรียกตัวดึงหลักครั้งเดียว ไม่หน่วงเวลา ไม่เรียกแหล่งสำรอง
// - ล่าช้า (lag > 0) → ดึงหลักซ้ำตามตารางหน่วงเวลา เฉพาะที่ยังอยู่ก่อนเส้นตายร่วมของทั้งรอบ (deadlineAt) แล้วค่อยลองแหล่งสำรอง
// - รับผลชุดใหม่ก็ต่อเมื่อ "ใหม่กว่าจริง" (lag น้อยลง) ไม่ผสมสองแหล่งในอนุกรมเดียว

export interface PolicyBars<B extends { date: string | null }> {
  bars: B[]
  source: string
  droppedLatestAt: string | null
}

export interface BarFetchPolicyDeps<B extends { date: string | null }> {
  fetchPrimary: () => Promise<PolicyBars<B>>
  fetchFallback: () => Promise<PolicyBars<B>>
  /** sessions ที่ bar ล่าสุดช้ากว่า session ที่ควรจบแล้ว; null = ไม่ทราบ (เช่น ไม่มี bar) */
  lagOf: (lastBarAt: string | null | undefined) => number | null
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export interface BarFetchPolicyOptions {
  /** เวลา epoch ms ที่ห้ามเลยของทั้งรอบ (ใช้ร่วมกันทุกหุ้นที่ดึงพร้อมกัน) */
  deadlineAt: number
  /** หน่วงก่อนดึงซ้ำครั้งที่ 1, 2, ... (ms) ความยาวของรายการคือจำนวนครั้งสูงสุดที่ดึงซ้ำ */
  retryDelaysMs: number[]
  /** แหล่งสำรองต้องมีอย่างน้อยกี่ bar (EMA200 ต้องการ 200) */
  minFallbackBars: number
}

export interface BarFetchPolicyResult<B extends { date: string | null }> extends PolicyBars<B> {
  attempts: number
  usedFallback: boolean
  lagSessions: number | null
  deadlineReached: boolean
}

export const DEFAULT_RETRY_DELAYS_MS = [6_000, 8_000]
export const DEFAULT_MIN_FALLBACK_BARS = 200
/** งบเวลาดึงซ้ำรวมทั้งรอบ post-close (cron maxDuration = 60 วินาที และยังต้องรอ AI) */
export const DEFAULT_RETRY_BUDGET_MS = 15_000

function newestDate<B extends { date: string | null }>(set: PolicyBars<B>): string | null {
  return set.bars.length ? set.bars[set.bars.length - 1].date : null
}

export async function fetchBarsWithStalenessPolicy<B extends { date: string | null }>(
  deps: BarFetchPolicyDeps<B>,
  options: BarFetchPolicyOptions,
): Promise<BarFetchPolicyResult<B>> {
  let current = await deps.fetchPrimary()
  let attempts = 1
  let lag = deps.lagOf(newestDate(current))
  let deadlineReached = false
  const done = (usedFallback: boolean): BarFetchPolicyResult<B> => ({ ...current, attempts, usedFallback, lagSessions: lag, deadlineReached })

  // ถูกอยู่แล้ว หรือไม่มีข้อมูลให้เทียบ → ไม่แตะอะไรเพิ่ม (พฤติกรรมเดิม)
  if (lag === null || lag <= 0) return done(false)

  for (const delay of options.retryDelaysMs) {
    if (deps.now() + delay > options.deadlineAt) {
      deadlineReached = true
      break
    }
    await deps.sleep(delay)
    const next = await deps.fetchPrimary()
    attempts += 1
    const nextLag = deps.lagOf(newestDate(next))
    if (next.bars.length > 0 && nextLag !== null && nextLag < lag) {
      current = next
      lag = nextLag
      if (lag <= 0) return done(false)
    }
  }

  // ยังล่าช้า: ลองแหล่งสำรองถ้ายังมีเวลา และใช้เฉพาะเมื่อใหม่กว่าจริงและยาวพอ
  if (deps.now() < options.deadlineAt) {
    const fallback = await deps.fetchFallback()
    const fallbackLag = deps.lagOf(newestDate(fallback))
    if (fallback.bars.length >= options.minFallbackBars && fallbackLag !== null && fallbackLag < lag) {
      current = fallback
      lag = fallbackLag
      return done(true)
    }
  } else {
    deadlineReached = true
  }
  return done(false)
}

export interface BarRetryItem {
  symbol: string
  attempts?: number | null
  usedFallback?: boolean | null
  lagSessions?: number | null
}

/** รายการสำหรับ log เฉพาะหุ้นที่ต้องดึงซ้ำ: `SYMBOL:attempts=N:lag=L[:fallback]` (ว่างเมื่อไม่มีใครต้องดึงซ้ำ) */
export function summarizeBarRetries(items: BarRetryItem[]): string[] {
  return items
    .filter(item => (item.attempts ?? 1) > 1 || item.usedFallback === true)
    .map(item => `${item.symbol}:attempts=${item.attempts ?? 1}:lag=${item.lagSessions ?? '?'}${item.usedFallback ? ':fallback' : ''}`)
}
