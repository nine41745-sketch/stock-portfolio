import { changelog as previousChangelog } from './changelog-v1271'
import type { ChangelogEntry } from './changelog'

const v1272: ChangelogEntry = {
  version: 'v1.27.2',
  date: '2026-09-17 01:35 ICT',
  changes: [
    'Release Metadata Hotfix: เพิ่มประวัติ v1.27.1 ที่ตกหล่นจาก Changelog และเลื่อน CURRENT_VERSION ให้ตรงกับ release ปัจจุบัน เพื่อให้ Version Badge/หน้าประวัติแสดงเวอร์ชันล่าสุดถูกต้อง',
    'Changelog Chain: เพิ่ม changelog-v1271 และ changelog-v1272 ตามโครงสร้างแยกไฟล์ราย release เดิม พร้อมอัปเดต TypeScript path alias ให้ชี้ release ล่าสุดโดยไม่ทิ้งประวัติ v1.27.0 และเวอร์ชันก่อนหน้า',
    'Version Consistency: อัปเดต package.json, package-lock.json และ release regression guards ให้เป็น 1.27.2 เพื่อให้ metadata ทุกจุดตรงกัน',
    'Scope Safety: เป็น metadata/changelog hotfix เท่านั้น ไม่เปลี่ยน business logic, portfolio accounting, Supabase schema, SQL หรือ Environment',
  ],
}

export const changelog: ChangelogEntry[] = [v1272, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
