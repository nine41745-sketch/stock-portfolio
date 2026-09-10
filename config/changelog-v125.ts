// Final Preview retrigger after v1.25.0 release metadata finalization.
import { changelog as previousChangelog } from './changelog-v124'
import type { ChangelogEntry } from './changelog'

const v1250: ChangelogEntry = {
  version: 'v1.25.0',
  date: '2026-09-10 17:53 ICT',
  changes: [
    'Alerts Notification Center: เพิ่มหน้ารวมสัญญาณ Stop, Target, Near Support, Breakout และ Earnings จากข้อมูล Holdings / Trade Plan / market data แบบ live-derived โดยไม่สร้างคำสั่งซื้อขายอัตโนมัติ',
    'Alert Methodology: Stop ใช้เฉพาะ Trade Plan สถานะ ENTERED, Target ใช้ WAITING/ENTERED, Near Support / Breakout ใช้ scanner support-resistance จาก completed bars และแสดง Volume Ratio เมื่อมีนัยสำคัญ',
    'Market Calendar: เพิ่มปฏิทิน Earnings ของหุ้นที่ติดตาม พร้อม US CPI และ FOMC schedule snapshot และตัวกรองช่วง 30 / 60 / 90 / 120 วัน',
    'Navigation: คงเมนูหลัก 6 เมนูเดิม และวาง 🔔 Alerts / 📅 Calendar เป็นเมนูย่อยภายใต้ 🎯 แผน เพื่อไม่ทำให้ top-level navigation หนาแน่นขึ้น',
    'Data Provenance: Earnings ใช้ Finnhub; CPI/FOMC ระบุแหล่งที่มาและวันตรวจสอบ schedule snapshot ชัดเจน พร้อมเตือนให้ recheck ใกล้วัน Event',
    'Regression & Safety: เพิ่ม Alerts + Calendar regression เข้า critical build gate; ฟีเจอร์เป็น read-only ไม่มี Supabase Migration และไม่แก้ Holdings, Transactions, Trade Plans, Cash, AI, Scanner, Cron หรือ Track Record',
  ],
}

export const changelog: ChangelogEntry[] = [v1250, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
