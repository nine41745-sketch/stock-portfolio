import { changelog as previousChangelog } from './changelog-v1413'
import type { ChangelogEntry } from './changelog'

const v1414: ChangelogEntry = {
  version: 'v1.41.4',
  date: 'Development History — Feature commit 2026-10-28 15:18:58 +07:00 (ไม่ใช่ Production)',
  changes: [
    'แสดงหลักฐานย้อนหลังจาก SEC เพื่อแยกหุ้นสามัญ EOSE และใบสำคัญแสดงสิทธิ EOSEW โดยไม่สรุปสถานะปัจจุบัน',
    'หากยังยืนยันชนิดหุ้นหรือข้อมูลที่จำเป็นไม่ได้ ระบบยังไม่คำนวณช่วงราคาจากกำไรต่อหุ้น',
  ],
}

export const changelog: ChangelogEntry[] = [v1414, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
