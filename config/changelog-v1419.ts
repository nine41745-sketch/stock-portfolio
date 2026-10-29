import { changelog as previousChangelog } from './changelog-v1418'
import type { ChangelogEntry } from './changelog'

const v1419: ChangelogEntry = {
  version: 'v1.41.9',
  date: 'Development History — Feature commit 2026-10-29 16:16:06 +07:00 (ไม่ใช่ Production)',
  changes: [
    'แสดงเวลาราคาจากผู้ให้บริการแยกจากเวลาที่ระบบตรวจข้อมูล และระบุชัดเมื่อใช้ราคาเก่าหรือไม่มีเวลา quote',
    'แสดงเหตุผลจากคะแนน Stock Scanner พร้อมอธิบายที่มาของ Target 2 และย้ำว่า R:R คำนวณถึง Target 1',
    'เมื่อ AI ส่งผลที่อ่านไม่ได้ ให้ใช้สรุป Stock Check พร้อมแจ้งผู้ใช้แทนการแสดง JSON ดิบ',
  ],
}

export const changelog: ChangelogEntry[] = [v1419, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
