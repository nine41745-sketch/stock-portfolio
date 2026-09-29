import { changelog as previousChangelog } from './changelog-v1290'
import type { ChangelogEntry } from './changelog'

const v1291: ChangelogEntry = {
  version: 'v1.29.1',
  date: '2026-09-30 04:18 ICT',
  changes: [
    'DIME Balance Clarity: เปลี่ยนคำอธิบายยอดเป็น “เงินสดคงเหลือ / Buying Power ใน DIME” ให้ตรงกับพฤติกรรมจริงที่ยอดถูกเพิ่มจาก SELL และถูกหักจาก BUY ผ่าน Auto Sync',
    'Timestamp Clarity: เปลี่ยน “แก้ไขล่าสุด” เป็น “อัปเดตล่าสุด” เพื่อครอบคลุมทั้งการอัปเดตจาก Auto Sync และการปรับยอดด้วยมือ',
    'Manual Override Safety: เพิ่มคำเตือนก่อนบันทึกยอด DIME ด้วยมือว่า การบันทึกจะเขียนทับยอดปัจจุบันที่ Auto Sync คำนวณไว้ เพื่อลดความเสี่ยงที่ยอด DIME กับ Transaction Ledger จะไม่สอดคล้องกัน',
    'Regression Guard: เพิ่ม tests กันข้อความเดิมที่ทำให้เข้าใจผิดกลับมา โดยไม่มี SQL migration, ไม่มี Supabase schema change และไม่มี Environment change',
  ],
}

export const changelog: ChangelogEntry[] = [v1291, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
