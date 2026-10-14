import { changelog as previousChangelog } from './changelog-v1340'
import type { ChangelogEntry } from './changelog'

const v1341: ChangelogEntry = {
  version: 'v1.34.1',
  date: '2026-10-15 00:03 ICT',
  changes: [
    'แก้ Tailwind dark: styles ให้ยึดธีมของแอปผ่าน [data-theme="dark"] แทนธีมของระบบปฏิบัติการ เพื่อให้สีและการอ่านในโหมดสว่าง/มืดตรงตามที่เลือก',
    'เพิ่ม Authenticated Browser QA และ regression checks สำหรับ OS/App Theme Matrix 4 คู่, Responsive 375/768/1440px, Accessibility/Contrast, Auth/PIN และสถานะ Loading/Error/Empty บน Supabase Local แบบ Disposable พร้อมข้อมูลสังเคราะห์',
    'ตรวจยืนยัน SEC warning และคงการปิด P/E Scenario Price; ไม่มีการแก้ฐานข้อมูล Cloud, Environment หรือเพิ่มการเขียนข้อมูลพอร์ต',
  ],
}

export const changelog: ChangelogEntry[] = [v1341, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
