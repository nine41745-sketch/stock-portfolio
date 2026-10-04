import { changelog as previousChangelog } from './changelog-v1291'
import type { ChangelogEntry } from './changelog'

const v1292: ChangelogEntry = {
  version: 'v1.29.2',
  date: '2026-10-04 15:16 ICT',
  changes: [
    'Pre-market Cron Reliability: เปลี่ยน gate แบบ exact hour เป็นหน้าต่าง 08:45–09:44 ET เพื่อรองรับ Vercel cron delivery delay โดยยังคง candidate สองเวลาเดิมสำหรับ EDT/EST และป้องกัน candidate ที่ไม่ active รันซ้ำ',
    'Pre-market Diagnostics: เพิ่มข้อมูล executedAtEt / activeWindow และ log สถานะ active/skip เพื่อแยกกรณี RUN, SKIP และช่วงเวลาที่ cron มาถึงได้ชัดเจนขึ้น',
    'Security Patch: อัปเดต Next.js จาก 16.3.4 เป็น 16.3.8 เพื่อแก้ critical next/og ImageResponse RCE advisory ที่บล็อก production dependency audit',
    'Regression Guard: เพิ่ม tests ครอบคลุม EDT, EST, delayed delivery, holiday และ duplicate-candidate boundaries พร้อมคง production audit/typecheck/build gate โดยไม่มี SQL migration, ไม่มี Supabase schema change และไม่มี Environment change',
  ],
}

export const changelog: ChangelogEntry[] = [v1292, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
