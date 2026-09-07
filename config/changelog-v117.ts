import { changelog as previousChangelog } from './changelog-v1161'
import type { ChangelogEntry } from './changelog'

const v117: ChangelogEntry = {
  version: 'v1.17.0',
  date: '2026-09-08 ICT',
  changes: [
    'Reproducible Builds: เพิ่ม package-lock.json และกำหนด Node.js >=20 เพื่อให้ dependency resolution ระหว่างเครื่องพัฒนา, CI และ deployment สม่ำเสมอขึ้น',
    'CI Standard: เพิ่ม GitHub Actions ตรวจ Critical Regression Tests, TypeScript และ Production Build ด้วย npm ci ก่อน merge',
    'Dependency Hygiene: ถอด @anthropic-ai/sdk ที่ไม่มีการใช้งานออก และเพิ่ม Dependabot ตรวจ npm dependencies รายสัปดาห์',
    'Security Headers: ปิด X-Powered-By และเพิ่ม nosniff, Referrer-Policy, frame protection, COOP และ Permissions-Policy โดยไม่แตะ Auth/PIN/RLS เดิม',
    'Operations Standard: เพิ่ม SECURITY.md และ OPERATIONS.md สำหรับ incident response, release gate, backup/restore checklist และข้อกำหนดเรื่อง secrets',
  ],
}

export const changelog: ChangelogEntry[] = [v117, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
