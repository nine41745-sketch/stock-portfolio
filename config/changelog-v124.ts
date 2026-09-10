// Final Preview retrigger after v1.24.0 release metadata finalization.
import { changelog as previousChangelog } from './changelog-v123'
import type { ChangelogEntry } from './changelog'

const v1240: ChangelogEntry = {
  version: 'v1.24.0',
  date: '2026-09-10 16:50 ICT',
  changes: [
    'Portfolio Risk Workspace: เพิ่มเมนู 🛡️ ความเสี่ยง สำหรับดู Position Concentration, Sector / Industry Concentration, Cash Buffer, Stop Coverage และความเสี่ยงรายหุ้นในหน้าเดียว',
    'Stop Risk: คำนวณ Loss → Stop และ Risk Contribution จาก Trade Plan สถานะ ENTERED เฉพาะ Stop ที่ต่ำกว่าราคาปัจจุบัน; หุ้นที่ไม่มี Stop หรือ Stop ถูกทะลุจะแสดงว่า Risk ยังวัดไม่ครบแทนการตีเป็นศูนย์',
    'Stress Scenario: จำลองผลกระทบต่อพอร์ตจากการขยับของหุ้นรายตัว พร้อม preset -10%, -20% และ -30% โดยสมมติสินทรัพย์อื่นคงที่',
    'Deterministic Risk Flags: เพิ่มคำเตือน concentration / cash buffer / stop coverage และ rebalance heuristics แบบ deterministic โดยไม่ใช้ AI ตัดสินซื้อขายและไม่ส่งคำสั่งอัตโนมัติ',
    'Data Provenance: ใช้ Holdings และราคาปัจจุบันจริง, cash_balance และ Finnhub profile2 finnhubIndustry; Dime แสดงแยกและไม่รวมในฐาน Risk เพื่อหลีกเลี่ยงการนับซ้ำ',
    'Regression & Safety: เพิ่ม Portfolio Risk regression เข้า critical build gate; Risk API เป็น read-only ไม่แก้ Holdings, Cost Basis, Cash, Transactions, Trade Plan, AI, Scanner, Cron หรือ Track Record และ v1.24.0 ไม่ต้องใช้ Supabase Migration เพิ่ม',
  ],
}

export const changelog: ChangelogEntry[] = [v1240, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
