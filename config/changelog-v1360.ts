import { changelog as previousChangelog } from './changelog-v1351'
import type { ChangelogEntry } from './changelog'

// Integrated development history; v1.36.0 has not been released separately.
const v1360: ChangelogEntry = {
  version: 'v1.36.0',
  date: 'Unreleased — รวมใน v1.37.0 Release Candidate',
  changes: [
    'Investment Discovery: Investment Themes, Trending Opportunities และ Market Radar จากกลุ่มตัวอย่างที่กำหนด โดยไม่อ้างว่าเป็นข้อมูลทั้งตลาด',
    'จำกัด 12 Unique Symbols, Candidate Concurrency 2 และ Overall Deadline พร้อม Cancellation; ข้อมูลไม่ครบแสดง Partial/Unavailable โดยไม่สร้างคะแนนสมมติ',
    'รวม Portfolio Initialization/Retry และการแยก Account/Portfolio; แก้ Shared ATH Cache ไม่ให้ Cached null ของ Legacy Consumer ขัดขวาง Discovery และรักษา Success Cache',
    'พัฒนาผ่าน PR #69 และรวมกับ v1.35.1 ใน PR #70; ยังไม่ Merge/Deploy หรือประกาศ v1.36.0 Released',
  ],
}

export const changelog: ChangelogEntry[] = [v1360, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
