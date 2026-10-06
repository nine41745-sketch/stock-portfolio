import { changelog as previousChangelog } from './changelog-v1293'
import type { ChangelogEntry } from './changelog'

const v1300: ChangelogEntry = {
  version: 'v1.30.0',
  date: '2026-10-06 19:59 ICT',
  changes: [
    'Trade Plan Real Execution: เพิ่มปุ่มบันทึก BUY/SELL จริงจาก Active Trade Plan โดยต้องกดยืนยันเองทุกครั้ง ไม่ใช่ Auto Trading',
    'Atomic Auto Sync: Transaction Ledger + Holdings + Dime + Trade Plan status อัปเดตใน database transaction เดียว; BUY → ENTERED, SELL บางส่วน → ENTERED, SELL จนหุ้นเหลือ 0 → CLOSED',
    'Execution Safety: ล็อก Trade Plan ก่อนบันทึก, ปฏิเสธแผน CLOSED/CANCELLED, ห้าม SELL จาก WAITING, ตรวจ Symbol ให้ตรงกับแผน และ Rollback ทั้งรายการเมื่อขั้นตอนไหนล้มเหลว',
    'Database: เพิ่ม service-role-only RPC สำหรับ Trade Plan execution โดยไม่มี table/column change; migration แยกไว้รออนุมัติก่อนใช้งานจริง',
  ],
}

export const changelog: ChangelogEntry[] = [v1300, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
