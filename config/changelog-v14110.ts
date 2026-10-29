import { changelog as previousChangelog } from './changelog-v1419'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.10',
  date: 'เวลาพัฒนา: รอบันทึกจาก Git commit',
  changes: [
    'ปรับประวัติเวอร์ชันให้อ่านเวลาและที่มาของเวลาได้ง่ายขึ้น',
    'ปรับคำอธิบายการเปลี่ยนแปลงให้เข้าใจง่ายขึ้น โดยคงหลักฐานเวลาเดิม',
  ],
}
export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
