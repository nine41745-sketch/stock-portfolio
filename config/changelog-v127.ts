import { changelog as previousChangelog } from './changelog-v126'
import type { ChangelogEntry } from './changelog'

const v127: ChangelogEntry = {
  version: 'v1.27.0',
  date: '2026-09-15 15:43 ICT',
  changes: [
    'Global Quick Notes & Investing Since: ย้าย Quick Notes ไปเป็น shared global drawer ผ่าน AppTabs และปรับระยะเวลาตั้งแต่เริ่มลงทุนให้แสดงแบบ ปี/เดือน/วัน โดยยึด Asia/Bangkok',
    'Multi-Portfolio Foundation: เพิ่มตัวเลือกพอร์ตและแยก Holdings, Transactions, Trade Plans, balances, Performance, Risk, AI, Alerts/Calendar, Cron และ Track Record ตาม portfolio_id พร้อม migration/verification SQL และ legacy fallback ก่อนติดตั้ง schema ใหม่',
    'Data Isolation & Safety: เพิ่ม portfolio-scoped RPC/RLS/API plumbing, backfill/default portfolio design และ regression coverage เพื่อป้องกันข้อมูลของแต่ละพอร์ตปะปนกัน; migration ถูกเตรียมไว้แต่ยังไม่ได้รันบน Supabase Production',
    'Stock Command Center: เพิ่มมุมมองพอร์ตที่เลือกพร้อมสถานะเงินสด, position weight และ Trade Plan เพื่อให้การตัดสินใจอ้างอิงพอร์ตจริงที่กำลังใช้งาน',
    'Buy / Tranche Simulator: เพิ่มการจำลองแบ่ง 1-3 ไม้โดยจำกัดวงเงินตามเงินสดจริง คำนวณราคาเฉลี่ย, Stop risk, Target gain และ concentration หลังซื้อ โดยไม่ส่งคำสั่งซื้อหรือแก้ Holdings อัตโนมัติ',
    'Verification: เพิ่ม regression สำหรับ Multi-Portfolio และ Command Center พร้อม CI lint/typecheck/tests/build และ Final Preview; release metadata นี้ไม่รัน SQL Production, ไม่ Merge และไม่ Deploy Production',
  ],
}

export const changelog: ChangelogEntry[] = [v127, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
