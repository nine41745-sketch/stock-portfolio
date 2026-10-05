import { changelog as previousChangelog } from './changelog-v1292'
import type { ChangelogEntry } from './changelog'

const v1293: ChangelogEntry = {
  version: 'v1.29.3',
  date: '2026-10-05 23:19 ICT',
  changes: [
    'Dependency Cleanup: อัปเดต React และ ReactDOM จาก 19.2.8 เป็น 19.3.0 พร้อม @types/react และ @types/react-dom 19.3.0 ให้ dependency family อยู่บน release เดียวกัน',
    'Next.js Tooling Alignment: อัปเดต eslint-config-next จาก 16.3.4 เป็น 16.3.8 ให้ตรงกับ Next.js 16.3.8 และอัปเดต Autoprefixer เป็น 10.6.1 โดยคง runtime Node 22 และ @types/node major 22',
    'Dependabot Maintenance: จัดกลุ่ม React family และ Next.js family ให้เสนออัปเดตเป็นชุดเดียว พร้อม ignore @types/node semver-major เพื่อลด PR ที่แยก dependency ซึ่งต้องอัปพร้อมกัน',
    'Verification: Dependency Cleanup ผ่าน CI, Vercel Preview และ Production smoke test หลัง Merge PR #40 โดยไม่มี SQL migration, ไม่มี Supabase schema change และไม่มี Environment change',
  ],
}

export const changelog: ChangelogEntry[] = [v1293, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
