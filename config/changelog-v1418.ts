import { changelog as previousChangelog } from './changelog-v1417'
import type { ChangelogEntry } from './changelog'

const v1418: ChangelogEntry = {
  version: 'v1.41.8',
  date: 'Development History — Feature commit 2026-10-29 13:07:20 +07:00 (ไม่ใช่ Production)',
  changes: [
    'เพิ่มข้อความช่วยตรวจสาเหตุเมื่อระบบเชื่อมต่อไม่ได้ โดยไม่เปิดเผยข้อมูลลับหรือข้อมูลพอร์ต',
    'ยังป้องกันการเข้าถึงเมื่อระบบทดสอบยืนยันสภาพแวดล้อมจริงไม่ได้',
  ],
}
export const changelog: ChangelogEntry[] = [v1418, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
