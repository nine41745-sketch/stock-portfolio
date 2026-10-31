import { changelog as previousChangelog } from './changelog-v14115'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.16',
  date: 'Development History — Feature commit 2026-10-31 12:09:31 +07:00 (ไม่ใช่ Production)',
  changes: [
    'การ์ดรอย่อที่ต้องรอราคาลดลงเกิน 5% แนะนำให้ตั้งแจ้งเตือนที่ขอบบนของโซน โดยยังแสดงการ์ดและสถานะเดิม',
    'แยกคะแนนแนวโน้มออกจากทิศทางราคา เพื่อให้อ่านระดับคะแนนและทิศทางได้ชัดเจนขึ้น',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
