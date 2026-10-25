import { changelog as previousChangelog } from './changelog-v1390'
import type { ChangelogEntry } from './changelog'

// Historical Production timing accepted from Vercel Activity, not a commit timestamp.
// Source: ae88fe8afe7c42e678c772a5e327bbd32ad78db7; deployment: dpl_A5RBfNMGekdcQyf56PG7GzKk1ie9.
// Promote: uev_7B1SgSgnZAuvItKyKq3dzTHY; subsequent alias assignment: uev_sBa8Lo4JAY8PAgGfGJKMJOOA.
const v1400: ChangelogEntry = {
  version: 'v1.40.0',
  date: '2026-10-23 03:55 ICT · Production',
  changes: [
    'Personal Investment Command Center รวม Snapshot แบบ read-only ของพอร์ตที่เลือกจาก Holdings, cash/DIME, Watchlist/Collections, Allocation, Rules และ Trade Plans ด้วยขอบเขต user/portfolio เดียวกัน',
    'แสดง Source, เวลาดึงข้อมูลจากแอป, เวลาที่ทราบจากแหล่งข้อมูล และสถานะ READY / STALE / UNAVAILABLE / ERROR / NOT_REQUESTED โดยไม่ตีความเวลา Snapshot ว่าข้อมูลตลาดสด',
    'ไม่เรียก Market Provider ตอนเปิดหน้า; Finnhub quote observations ถูกเรียกเฉพาะเมื่อผู้ใช้สั่งและจำกัด 12 Ticker; ไม่เปิด SEC Live, Groq, Scanner/Discovery scan หรือ Background Polling อัตโนมัติ',
    'ใช้ Cash, DIME, FIFO, Risk และ Planning semantics เดิม; ไม่มีการรวมเงินสดกับ DIME ซ้ำ ไม่มีคำสั่งซื้อขายอัตโนมัติ และไม่มีการเปลี่ยน Database Schema หรือเพิ่ม Dependency',
    'ยืนยันวันเวลาเผยแพร่ Production จากเหตุการณ์ Promote และ Assign Alias ใน Vercel Activity ที่ตรวจรับแล้ว โดยไม่ใช้เวลา Commit แทน และไม่อ้างเวลาเผยแพร่แยกให้รุ่นก่อนหน้า',
    'ประวัติช่วงพัฒนา: เคยบันทึก Release Gate: HOLD — Full Audit baseline 7 High; หลักฐานวันเวลาเผยแพร่ไม่ใช่การรับรองผล QA ความถูกต้องของตัวเลขพอร์ต หรือการปลด Security Gate ย้อนหลัง',
  ],
}

export const changelog: ChangelogEntry[] = [v1400, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
