import { changelog as previousChangelog } from './changelog-v122'
import type { ChangelogEntry } from './changelog'

const v1230: ChangelogEntry = {
  version: 'v1.23.0',
  date: '2026-09-10 15:38 ICT',
  changes: [
    'Trade Plan Workspace: เพิ่มเมนู 🎯 แผน สำหรับวาง Planned Entry, Add Zone, Stop Loss, Target 1/2, Budget, จำนวนหุ้น และสถานะ WAITING / ENTERED / CANCELLED / CLOSED ก่อนส่งคำสั่งซื้อจริง',
    'Risk Planning: คำนวณราคาเข้ากลางโซน, จำนวนหุ้นตามงบ, Risk ต่อหุ้น, Max Loss @ Stop และ R:R Target 1/2 แบบ deterministic โดยไม่พึ่ง AI',
    'Stock Check Integration: เพิ่มทางส่งผลจาก 🔬 Stock Check เข้า Trade Plan เพื่อ prefill Entry / Stop / Target / Budget และให้ผู้ใช้ตรวจแก้ก่อนบันทึก',
    'Data Safety: Trade Plan แยกจาก Holdings และ Transaction Ledger; การสร้าง แก้ไข เปลี่ยนสถานะ หรือลบแผนไม่เปลี่ยนจำนวนหุ้น Cost Basis เงินสด และไม่สร้าง BUY/SELL อัตโนมัติ',
    'Security & Persistence: เพิ่ม trade_plans พร้อม RLS, หนึ่ง Active Plan ต่อ Symbol และเข้ารหัส Entry/Stop/Target/Budget/Shares/Notes at rest ผ่าน service-role-only RPCs; Preview CRUD ผ่านหลังติดตั้ง Migration ที่ได้รับอนุมัติแยก',
    'Regression Safety: เพิ่ม Trade Plan regression เข้า critical build gate และคง Portfolio, Scanner, Stock Check, Transactions, Performance, Daily Cron และ Track Record เดิมไว้',
  ],
}

export const changelog: ChangelogEntry[] = [v1230, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
