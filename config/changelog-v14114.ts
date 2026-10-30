import { changelog as previousChangelog } from './changelog-v14113'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.14',
  date: 'รอบันทึกเวลาพัฒนาจาก Git commit',
  changes: [
    'แยกขอบบนและราคากลางของแผนรอย่อ พร้อมแสดงเวลาและอธิบายข้อจำกัดของ R:R ให้เข้าใจง่ายขึ้น',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
