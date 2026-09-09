import { changelog as previousChangelog } from './changelog-v120'
import type { ChangelogEntry } from './changelog'

const v1210: ChangelogEntry = {
  version: 'v1.21.0',
  date: '2026-09-10 02:16 ICT',
  changes: [
    'Transaction Ledger: เพิ่มเมนูธุรกรรมสำหรับ BUY / SELL / ยอดหุ้นตั้งต้น / ปันผล / ฝากเงิน / ถอนเงิน พร้อมเพิ่ม แก้ไข ลบ และตัวกรอง',
    'Holdings Reconciliation: เพิ่มการตรวจเทียบ Opening + BUY - SELL กับจำนวนหุ้นใน Holdings โดยไม่แก้ Holdings อัตโนมัติ',
    'Existing Portfolio Adoption: เพิ่ม OPENING_POSITION เพื่อรับยอดหุ้นเดิมเข้าระบบโดยไม่ต้องสร้างประวัติซื้อย้อนหลังปลอม',
    'Encrypted Ledger: ราคา ค่าธรรมเนียม และจำนวนเงินถูกเข้ารหัสด้วย pgcrypto และอ่าน/เขียนผ่าน service-role-only RPC',
    'Database Security: เพิ่ม portfolio_transactions, RLS, constraint, indexes และจำกัดสิทธิ์ RPC/ตารางสำหรับ browser',
    'Regression Safety: เพิ่ม Transaction Ledger regression gate และยืนยันว่า Holdings, cost basis, cash balance, Daily Cron, Portfolio AI และ Track Record เดิมไม่ถูกแก้โดย Ledger',
  ],
}

export const changelog: ChangelogEntry[] = [v1210, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
