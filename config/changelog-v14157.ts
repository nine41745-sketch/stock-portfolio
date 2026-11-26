import { changelog as previousChangelog } from './changelog-v14156'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.57',
  date: 'Development History — Feature commit 2026-11-26 12:00:00 +07:00 (ไม่ใช่ Production)',
  changes: [
    'แก้ปัญหาตัวชี้วัดรายวันล่าช้า 1 วันซื้อขายในรอบวิเคราะห์หลังตลาดปิด: เมื่อพบว่า bar ล่าสุดช้ากว่าวันซื้อขายที่ปิดแล้ว ระบบจะดึงข้อมูลซ้ำสั้นๆ (หน่วง 6 และ 8 วินาที ภายในเส้นตายร่วม 15 วินาทีของทั้งรอบ) แล้วลองแหล่งสำรอง (Stooq) ถ้ามีข้อมูลใหม่กว่าและยาวพอ ไม่ผสมสองแหล่งในอนุกรมเดียว และบันทึกจำนวนครั้งที่ดึงกับแหล่งข้อมูลที่ใช้',
    'ข้อมูลที่ถูกต้องอยู่แล้วทำงานเหมือนเดิมทุกประการ (ไม่มีการหน่วงเวลา) และใช้เฉพาะรอบหลังตลาดปิดเท่านั้น ไม่เปลี่ยนรอบก่อนตลาดเปิด สแกนเนอร์ หรือหน้าอื่น ไม่เปลี่ยนกติกา prompt ฐานข้อมูล หรือเวลา cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
