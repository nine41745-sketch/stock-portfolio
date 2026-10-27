import { changelog as previousChangelog } from './changelog-v1411'
import type { ChangelogEntry } from './changelog'

const v1412: ChangelogEntry = {
  version: 'v1.41.2',
  date: 'Development History — Feature commit 2026-10-28 03:20:46 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ปรับการตรวจสอบโดเมน Production ให้รองรับทั้งสองโดเมน พร้อมตรวจตัวตน Deployment ก่อนเข้าถึงระบบ',
    'เพิ่มการทดสอบว่าระบบยังปฏิเสธ Staged และ Cron ที่ไม่ใช่ Deployment ปัจจุบัน',
  ],
}

export const changelog: ChangelogEntry[] = [v1412, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
