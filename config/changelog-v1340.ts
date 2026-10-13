import { changelog as previousChangelog } from './changelog-v1331'
import type { ChangelogEntry } from './changelog'

const v1340: ChangelogEntry = {
  version: 'v1.34.0',
  date: '2026-10-14 03:05 ICT',
  changes: [
    'Fundamental Analysis: แสดง Finnhub Metrics และ Company Profile พร้อมแหล่งข้อมูล งวด หน่วย สกุลเงิน สถานะข้อมูล และเวลาที่ระบบรับข้อมูล',
    'Stock Comparison: เปรียบเทียบได้สูงสุด 4 หุ้น โดยรวมสัญลักษณ์ซ้ำและแจ้งเมื่อหน่วย สกุลเงิน หรืองวดไม่เข้ากัน',
    'Earnings Intelligence: ใช้ Earnings Calendar เดิม; Actual vs Estimate ยังไม่เปิดใช้จนกว่าจะยืนยันสิทธิ์และรูปแบบข้อมูลของ Finnhub',
    'Stock Valuation: เพิ่ม P/E Bear/Base/Bull Scenarios จาก EPS TTM และสมมติฐานที่ผู้ใช้กำหนด โดยไม่ใช้ AI สร้างตัวเลขหรือส่งคำสั่งซื้อขาย',
    'Read-only: ใช้ข้อมูลสาธารณะพร้อม Cache ที่กำหนดอายุ ไม่มี Database Migration, Portfolio Data หรือการเขียนรายการลงทุนใหม่',
  ],
}

export const changelog: ChangelogEntry[] = [v1340, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
