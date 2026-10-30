import { changelog as previousChangelog } from './changelog-v14112'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.13',
  date: 'Development History — Feature commit 2026-10-30 12:40:32 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ปรับการ์ด “รอราคาทะลุแนวต้าน” ให้แสดงจุดทะลุและระยะจากราคาปัจจุบัน พร้อมเงื่อนไขยืนยันด้วยราคาปิดและปริมาณซื้อขาย โดยไม่แสดงแผนซื้อก่อนทะลุ',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
