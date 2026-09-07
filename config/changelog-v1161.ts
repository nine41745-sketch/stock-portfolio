import { changelog as previousChangelog } from './changelog-v116'
import type { ChangelogEntry } from './changelog'

const v1161: ChangelogEntry = {
  version: 'v1.16.1',
  date: '2026-09-08 02:48 ICT',
  changes: [
    'Data Safety: ถ้าโหลด holdings/decrypt ไม่สำเร็จ Dashboard จะเข้า error boundary แทนการแสดงพอร์ตว่าง และยอดเงินจะไม่ถูกแสดงเป็น 0 จาก failed API read',
    'FX Safety: แยก live USD/THB ออกจาก fallback ชัดเจน, ใช้ timeout กับ provider และห้ามบันทึกยอดที่กรอกเป็น THB ระหว่างใช้ fallback เพื่อกันการแปลง USD ผิด',
    'AI/Cron Reliability: Manual Analyze และ Daily Cron fail closed เมื่อโหลด cash settings ไม่ได้ และ Cron ปฏิเสธการทำงานทันทีหาก CRON_SECRET ไม่ได้ตั้งค่า',
    'Mutation/Error Handling: Quick Notes ไม่ auto-save ทับข้อมูลเดิมเมื่อ initial load ล้มเหลว, ตรวจ HTTP status ก่อนแสดง save success, Track Record มี error state และ Manual PIN Lock ต้องยืนยัน server lock สำเร็จก่อนเปลี่ยนหน้า',
    'Validation: PUT holding ต้องมี shares ชัดเจน, shares รองรับสูงสุด 6 ตำแหน่ง, financial settings สูงสุด 2 ตำแหน่ง และ /api/prices validate/dedupe/cap ticker list',
    'Security Cleanup: Logout จากหน้า PIN พยายามลบ PIN session ก่อน Supabase signOut เพิ่มอีกชั้น โดยคง session binding และ PIN-only inactivity lock เดิมไว้',
  ],
}

export const changelog: ChangelogEntry[] = [v1161, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
