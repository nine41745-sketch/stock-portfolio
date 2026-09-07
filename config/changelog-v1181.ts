import { changelog as previousChangelog } from './changelog-v118'
import type { ChangelogEntry } from './changelog'

const v1181: ChangelogEntry = {
  version: 'v1.18.1',
  date: '2026-09-08 05:00 ICT',
  changes: [
    'Version History: เพิ่มเวลา ICT ในประวัติเวอร์ชันล่าสุดให้แสดงรูปแบบ YYYY-MM-DD HH:MM ICT และเติมเวลาจริงของ v1.16.1, v1.17.0 และ v1.18.0 จาก Git merge history',
    'Regression Guard: เพิ่ม Critical Test ป้องกัน release metadata ย้อนกลับไปใช้วันที่ที่ไม่มีเวลา และอัปเดต changelog alias ให้ชี้ v1.18.1',
    'Metadata-only Hotfix: ไม่มี SQL migration และไม่เปลี่ยน holdings, cost basis, cash, Dime, AI logic, Scanner, Watchlist, Supabase schema/RLS หรือ PIN/Auth',
  ],
}

export const changelog: ChangelogEntry[] = [v1181, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
