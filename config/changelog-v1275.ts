import { changelog as previousChangelog } from './changelog-v1274'
import type { ChangelogEntry } from './changelog'

const v1275: ChangelogEntry = {
  version: 'v1.27.5',
  date: '2026-09-19 19:51 ICT',
  changes: [
    'Supabase Maintenance: อัปเดต @supabase/ssr จาก 0.5.2 เป็น 0.12.7 และ lockfile ใช้ @supabase/supabase-js 2.116.0 ที่เข้ากันได้ หลังตรวจ compatibility กับ Auth/Cookies ของระบบแล้ว',
    'Auth/Cookie Compatibility: server และ proxy ใช้ getAll()/setAll() ตาม cookie adapter รุ่นใหม่อยู่แล้ว; Login, PIN, refresh session, logout และเปิด Preview ใหม่ผ่าน Functional Preview',
    'Runtime/CI Safety: Node 22 pin ยังเดิม, npm audit production dependencies = 0 vulnerabilities และ CI ตรวจ lint, typecheck, critical regressions และ production build ก่อน release',
    'Scope: ไม่มี SQL migration, ไม่มี Environment change และไม่มีการเปลี่ยน business logic ของระบบหุ้นใน maintenance release นี้',
  ],
}

export const changelog: ChangelogEntry[] = [v1275, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
