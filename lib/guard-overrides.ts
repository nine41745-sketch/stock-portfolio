// v1.41.49: สรุป "AI เสนอ vs ระบบสั่ง" จาก decisionTrace ของผลวิเคราะห์ (ใช้ใน /api/track-record)
// ไฟล์นี้ไม่มี import เพื่อให้เทสต์โหลดได้โดยตรง
export interface GuardOverrideSummary {
  traced: number
  overridden: number
  byGuard: Record<string, number>
}

const KNOWN_GUARDS = new Set(['SELL_ALL_EVIDENCE', 'BUY_CASH', 'BUY_CAPACITY', 'EXECUTION_GUARD', 'SCALE_IN_GUARD'])

export function summarizeGuardOverrides(results: unknown[]): GuardOverrideSummary {
  const summary: GuardOverrideSummary = { traced: 0, overridden: 0, byGuard: {} }
  for (const result of results) {
    const trace = (result as { decisionTrace?: { steps?: unknown } } | null)?.decisionTrace
    if (!trace || !Array.isArray(trace.steps)) continue
    summary.traced++
    const guards = trace.steps
      .map(step => (step as { guard?: unknown })?.guard)
      .filter((guard): guard is string => typeof guard === 'string' && KNOWN_GUARDS.has(guard))
    if (guards.length === 0) continue
    summary.overridden++
    for (const guard of guards) summary.byGuard[guard] = (summary.byGuard[guard] ?? 0) + 1
  }
  return summary
}
