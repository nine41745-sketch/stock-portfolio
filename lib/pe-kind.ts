export type PeKind = 'ANNUAL' | 'TTM'

// Finnhub exposes several P/E fields. The portfolio shows one number, so record which kind it is:
// the first available field wins, in the same order the portfolio has always used.
const PE_FIELDS: ReadonlyArray<{ field: string; kind: PeKind }> = [
  { field: 'peNormalizedAnnual', kind: 'ANNUAL' },
  { field: 'peTTM', kind: 'TTM' },
  { field: 'peBasicExclExtraTTM', kind: 'TTM' },
  { field: 'peExclExtraTTM', kind: 'TTM' },
]

export function selectPe(metric: Record<string, unknown> | null | undefined): { pe: number | null; peKind: PeKind | null } {
  for (const { field, kind } of PE_FIELDS) {
    const value = metric?.[field]
    if (typeof value === 'number' && Number.isFinite(value)) return { pe: value, peKind: kind }
  }
  return { pe: null, peKind: null }
}

export function peKindLabel(kind: PeKind | null | undefined): string | null {
  if (kind === 'ANNUAL') return 'รายปี'
  if (kind === 'TTM') return 'TTM'
  return null
}

export function peKindHint(kind: PeKind | null | undefined): string {
  if (kind === 'ANNUAL') return 'P/E แบบรายปีปรับค่า (Finnhub) อาจต่างจาก P/E แบบ TTM ในหน้าพื้นฐาน/มูลค่า'
  if (kind === 'TTM') return 'P/E แบบ TTM 12 เดือนล่าสุด (Finnhub) อาจต่างจาก P/E แบบรายปีของหุ้นตัวอื่น'
  return 'ไม่ทราบชนิดของ P/E'
}
