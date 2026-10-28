import { changelog as previousChangelog } from './changelog-v1416'
import type { ChangelogEntry } from './changelog'

const v1417: ChangelogEntry = {
  version: 'v1.41.7',
  date: 'Development History — รอบันทึกเวลาจาก commit จริง',
  changes: [
    'ปรับหน้าพื้นฐานและมูลค่าให้แสดงข้อมูลสำคัญและจัดกลุ่มข้อมูลเพิ่มเติมอ่านง่ายขึ้น',
    'แสดงข้อจำกัด SEC และ P/E Scenario ให้ชัดเจนโดยคงเงื่อนไขการป้องกันเดิม',
  ],
}
export const changelog: ChangelogEntry[] = [v1417, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
