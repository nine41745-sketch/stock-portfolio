import { changelog as previousChangelog } from './changelog-v14154'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.55',
  date: 'Development History — Feature commit 2026-11-25 18:25:21 +07:00 (ไม่ใช่ Production)',
  changes: [
    'เปลี่ยนหน้าต่างยืนยัน/แจ้งผลของเบราว์เซอร์ (window.confirm / alert / prompt) เป็นกล่องในหน้า เพราะเบราว์เซอร์แบบฝังอาจบล็อกหน้าต่างเหล่านี้จนปุ่มดูเหมือนไม่ทำงาน: ยืนยันบันทึกซื้อขายจริงจาก Trade Plan, ลบ Trade Plan, แก้ไข/ลบรายการ Ledger, ล้างโน้ตด่วน, ตั้งชื่อพอร์ตใหม่ และข้อความแจ้งผลหลังบันทึกซื้อ/ขาย',
    'กล่องยืนยันโฟกัสที่ปุ่มยกเลิกก่อน กด Esc เพื่อยกเลิก และคืนโฟกัสให้ปุ่มที่เปิดกล่อง การบันทึกซื้อขายจริงยังเรียก API แบบ Atomic เดิมจากปุ่มยืนยันที่เดียว ไม่เปลี่ยนตรรกะการบันทึก ฐานข้อมูล หรือ cron',
    'ยกเว้นตัวกันออกจากหน้า Trading Journal (แบบร่างที่ยังไม่บันทึก) ซึ่งยังใช้หน้าต่างของเบราว์เซอร์ เพราะต้องตอบทันทีในจังหวะเปลี่ยนหน้า',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
