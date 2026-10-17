import { changelog as previousChangelog } from './changelog-v1390'
import type { ChangelogEntry } from './changelog'

// Local development candidate only; this entry does not imply merge, deployment, or release.
const v1400: ChangelogEntry = {
  version: 'v1.40.0',
  date: 'Unreleased — Release Candidate',
  changes: [
    'Personal Investment Command Center รวม Snapshot แบบ read-only ของพอร์ตที่เลือกจาก Holdings, cash/DIME, Watchlist/Collections, Allocation, Rules และ Trade Plans ด้วยขอบเขต user/portfolio เดียวกัน',
    'แสดง Source, เวลาดึงข้อมูลจากแอป, เวลาที่ทราบจากแหล่งข้อมูล และสถานะ READY / STALE / UNAVAILABLE / ERROR / NOT_REQUESTED โดยไม่ตีความเวลา Snapshot ว่าข้อมูลตลาดสด',
    'ไม่เรียก Market Provider ตอนเปิดหน้า; Finnhub quote observations ถูกเรียกเฉพาะเมื่อผู้ใช้สั่งและจำกัด 12 Ticker; ไม่เปิด SEC Live, Groq, Scanner/Discovery scan หรือ Background Polling อัตโนมัติ',
    'ใช้ Cash, DIME, FIFO, Risk และ Planning semantics เดิม; ไม่มีการรวมเงินสดกับ DIME ซ้ำ ไม่มีคำสั่งซื้อขายอัตโนมัติ และไม่มีการเปลี่ยน Database Schema หรือเพิ่ม Dependency',
    'Release Gate: HOLD — Full Audit baseline 7 High; v1.40.0 ยัง Unreleased และต้องผ่านการตรวจรับ/CI/Authenticated QA ที่ได้รับอนุมัติก่อนพิจารณา Release',
  ],
}

export const changelog: ChangelogEntry[] = [v1400, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
