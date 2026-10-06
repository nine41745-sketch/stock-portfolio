import { changelog as previousChangelog } from './changelog-v1310'
import type { ChangelogEntry } from './changelog'

const v1311: ChangelogEntry = {
  version: 'v1.31.1',
  date: '2026-10-07 01:40 ICT',
  changes: [
    'UI/UX Polish: จัดลำดับ Header, KPI, Cards, Tables และ Action hierarchy ให้กระชับ อ่านง่าย และสม่ำเสมอทั้งระบบ',
    'Copy System: ปรับถ้อยคำไทย/อังกฤษ ป้ายสถานะ หัวข้อ ปุ่ม และข้อความช่วยเหลือให้ใช้รูปแบบเดียวกัน โดยคงศัพท์ตลาดหุ้นที่จำเป็น',
    'Portfolio + Analytics: ลด Utility ซ้ำในหน้า Portfolio, ปรับ KPI/ตาราง/AI Insight และทำ Performance/Risk/Allocation ให้อ่านง่ายขึ้น',
    'Safety: เป็นการปรับ Presentation เท่านั้น ไม่เปลี่ยนสูตรคำนวณ, Trade execution, Authentication, Database, Supabase หรือ Environment',
  ],
}
export const changelog: ChangelogEntry[] = [v1311, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
