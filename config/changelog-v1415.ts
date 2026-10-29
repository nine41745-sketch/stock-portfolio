import { changelog as previousChangelog } from './changelog-v1414'
import type { ChangelogEntry } from './changelog'

const v1415: ChangelogEntry = {
  version: 'v1.41.5',
  date: 'Development History — Feature commit 2026-10-29 00:21:41 +07:00 (ไม่ใช่ Production)',
  changes: [
    'แสดงกำไรต่อหุ้นรายปีระดับบริษัทจาก SEC พร้อมแหล่งข้อมูลและข้อจำกัด แม้ยังยืนยันชนิดหุ้นไม่ได้',
    'หากหลักฐานยังไม่พอ ระบบยังไม่ใช้กำไรต่อหุ้นคำนวณช่วงราคา',
  ],
}
export const changelog: ChangelogEntry[] = [v1415, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
