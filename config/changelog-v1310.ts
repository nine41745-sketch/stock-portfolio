import { changelog as previousChangelog } from './changelog-v1300'
import type { ChangelogEntry } from './changelog'

const v1310: ChangelogEntry = {
  version: 'v1.31.0',
  date: '2026-10-06 22:10 ICT',
  changes: [
    'Target Allocation: ตั้งสัดส่วนเป้าหมายรายหุ้นและ DIME Cash แยกตามพอร์ต โดย Target รวมต้องเท่ากับ 100%',
    'Rebalance Planner: แสดง Current vs Target, Overweight/Underweight, Full Rebalance Gap และแผนเติมเงินใหม่แบบไม่บังคับขาย',
    'Portfolio Basis: Allocation ใช้มูลค่าหุ้นปัจจุบัน + DIME Buying Power; เงินในธนาคารไม่รวมเพื่อป้องกัน double-counting',
    'Safety + Database: Rebalance เป็น read-only recommendation ไม่สร้าง BUY/SELL; เพิ่ม target table + service-role-only atomic save RPC ใน migration ที่รออนุมัติก่อนใช้งานจริง',
  ],
}

export const changelog: ChangelogEntry[] = [v1310, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
