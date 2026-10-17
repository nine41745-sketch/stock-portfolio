import { changelog as previousChangelog } from './changelog-v1380'
import type { ChangelogEntry } from './changelog'

// Local development candidate only; this entry does not imply merge, deployment, or release.
const v1390: ChangelogEntry = {
  version: 'v1.39.0',
  date: 'Unreleased — Release Candidate',
  changes: [
    'Smart Dip Buying ใช้ข้อมูล Holdings, Watchlist, DIME, Target Allocation, ค่าธรรมเนียม และ Support/Resistance ของพอร์ตที่เลือก เพื่อจำลองแผน 1–3 Tranche แบบ read-only',
    'Decision states REVIEW_DIP / WAIT / BLOCKED อธิบายเหตุผล, freshness, assumptions, Reserve, projected weight และข้อมูลที่ขาด โดยไม่สร้างคำสั่งซื้อขายอัตโนมัติ',
    'ใช้เฉพาะ DIME ที่ยืนยันได้ ไม่บวก cash_balance ซ้ำ; ปฏิเสธข้อมูลราคา/สกุลเงิน/Portfolio ที่ไม่ครบหรือเก่า และบล็อกแผนที่เกิน Reserve, Budget, Fees หรือ Allocation cap',
    'ไม่เพิ่ม Database Schema, Migration, Dependencies, Provider Integration, Persistence, SEC Live Request หรือการซื้อขายจริง',
    'Release Gate: HOLD — Full Audit 7 High; v1.39.0 ยัง Unreleased และไม่มีสิทธิ์ Push, Merge, Deploy, Tag หรือ Release จาก Local Development นี้',
  ],
}

export const changelog: ChangelogEntry[] = [v1390, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
