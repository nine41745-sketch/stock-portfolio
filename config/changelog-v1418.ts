import { changelog as previousChangelog } from './changelog-v1417'
import type { ChangelogEntry } from './changelog'

const v1418: ChangelogEntry = {
  version: 'v1.41.8',
  date: 'Development History — รอหลักฐานเวลา Git commit',
  changes: [
    'เพิ่มรหัสวินิจฉัยการตรวจ identity โดยไม่บันทึกข้อมูลลับหรือข้อมูลพอร์ต',
    'คงการป้องกัน Staged และ Preview เมื่อยืนยัน Production ไม่ได้',
  ],
}
export const changelog: ChangelogEntry[] = [v1418, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
