import { changelog as previousChangelog } from './changelog-v14145'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.46',
  date: 'Development History — Feature commit 2026-11-18 09:34:00 +07:00 (ไม่ใช่ Production)',
  changes: [
    'อัปเดต dependency ตามที่ Dependabot เสนอ (PR #51, #77, #75) รวมเป็นรุ่นเดียว: Next.js และ eslint-config-next 16.4.5 → 16.4.6 (backport แก้บั๊ก), @supabase/supabase-js 2.116.0 → 2.119.0 (รุ่นล่าสุด; PR #77 เสนอ 2.118.0 แต่ล้าสมัยแล้ว), @axe-core/playwright 4.13.0 → 4.14.0 (dev only)',
    'แก้เทสต์ที่ล็อกเวอร์ชันตรงตัวให้ตรงกับรุ่นใหม่ (ซึ่งเป็นสาเหตุที่ PR ของ Dependabot ล้มมาตลอด) ไม่ลดเงื่อนไขหรือ assertion ใด',
    'ไม่เปลี่ยนหน้าจอ API ฐานข้อมูล การวิเคราะห์ AI หรือเวลาการทำงานของ cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
