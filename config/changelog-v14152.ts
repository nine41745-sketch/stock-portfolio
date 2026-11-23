import { changelog as previousChangelog } from './changelog-v14151'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.52',
  date: 'Development History — Feature commit 2026-11-23 11:59:58 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ตัดส่วน AI ออกจากแท็บ "เช็กหุ้น" ในหน้าสแกนหุ้น (ปุ่ม "วิเคราะห์เชิงลึกด้วย AI" และการ์ด AI Deep Analysis) เพราะคำแนะนำจาก AI ของหุ้นที่ถืออยู่ดูได้ที่หน้า "คำแนะนำวันนี้" แล้ว',
    'ผลเช็กหุ้นแบบใช้กฎคำนวณ (Entry Zone, Stop Loss, Target, ขนาดสถานะจากงบ, ส่งเข้า Trade Plan, เพิ่มใน Watchlist) ยังใช้ได้เหมือนเดิม',
    'ปิดช่องทางเรียก AI จากหน้าสแกนหุ้น (ลบ API และโค้ดที่ไม่ใช้แล้ว) จึงไม่ใช้โควตา Groq จากหน้านี้อีก',
    'ไม่เปลี่ยนกติกาการตัดสินใจ ฐานข้อมูล หรือเวลาการทำงานของ cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
