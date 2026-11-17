import { changelog as previousChangelog } from './changelog-v14119'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.20',
  date: 'Development History — Feature commit 2026-11-03 13:06:34 +07:00 (ไม่ใช่ Production)',
  changes: [
    'Stock Check อธิบายว่าค่า P/E มาจาก Finnhub และชนิดอาจเป็นรายปีปรับค่าหรือ TTM ตามข้อมูลที่มี เพื่อไม่ให้เทียบกับหน้าพื้นฐานผิดชนิด',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
