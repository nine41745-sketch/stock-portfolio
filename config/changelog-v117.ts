import { changelog as previousChangelog } from './changelog-v1161'
import type { ChangelogEntry } from './changelog'

const v117: ChangelogEntry = {
  version: 'v1.17.0',
  date: '2026-09-08 ICT',
  changes: [
    'Reproducible Builds: เพิ่ม package-lock.json, pin Node.js 22 และใช้ npm ci ใน CI เพื่อให้ dependency resolution ระหว่าง CI และ deployment สม่ำเสมอขึ้น',
    'Framework Security: อัปเกรด Next.js เป็น 16.3.4 เพื่อปิด high-severity PostCSS advisory ใน dependency chain และย้าย middleware.ts เป็น proxy.ts ตามมาตรฐาน Next.js 16 โดยคง Auth/PIN gate เดิม',
    'CI Standard: เพิ่ม GitHub Actions ตรวจ production dependency audit, ESLint, Critical Regression Tests, TypeScript และ Production Build ก่อน merge',
    'Dependency Hygiene: ถอด @anthropic-ai/sdk ที่ไม่มีการใช้งานออก และเพิ่ม Dependabot ตรวจ npm dependencies รายสัปดาห์',
    'Security Headers: ปิด X-Powered-By และเพิ่ม nosniff, Referrer-Policy, frame protection, COOP และ Permissions-Policy โดยไม่เปลี่ยน RLS/PIN/session semantics',
    'Operations Standard: เพิ่ม SECURITY.md และ OPERATIONS.md สำหรับ incident response, release gate, backup/restore checklist และข้อกำหนดเรื่อง secrets',
  ],
}

export const changelog: ChangelogEntry[] = [v117, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
