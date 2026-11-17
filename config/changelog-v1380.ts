import { changelog as previousChangelog } from './changelog-v1370'
import type { ChangelogEntry } from './changelog'

// Feature commit time; this is not a Production release time.
const v1380: ChangelogEntry = {
  version: 'v1.38.0',
  date: 'Development History — Feature commit 2026-10-18 02:48 ICT (ไม่ใช่ Production)',
  changes: [
    'Trading Journal แบบ transaction-linked draft-only ในหน่วยความจำ แยกตามพอร์ต โดยไม่เปลี่ยน Ledger และไม่มีความทนทานข้ามการ Reload/อุปกรณ์',
    'Advanced Trade Statistics ใช้หนึ่ง SELL ที่ FIFO ยอมรับเป็นหนึ่งดีล พร้อม Win/Loss/Breakeven, Average Win/Loss, Profit Factor, Expectancy และค่าธรรมเนียมที่บันทึก',
    'FX Profit Attribution แสดง Unavailable เพราะ Transaction Ledger ปัจจุบันไม่มีสกุลเงินหรือ Historical FX Rates; เพิ่มสูตรที่ตรวจสอบได้สำหรับข้อมูลอัตราที่มี Provenance ในอนาคต โดยไม่ประมาณ Spot Rate',
    'ไม่เปลี่ยน Database Schema, Migration, Dependencies, Auth/PIN, Portfolio Isolation หรือ Provider Integrations',
    'ประวัติขณะเตรียมรุ่น: Security / Production Release Gate: HOLD — Full Audit 7 High; ขณะนั้นยังไม่มีสิทธิ์ Push, Merge, Deploy หรือสร้าง Tag/Release บันทึกนี้ไม่ใช่สถานะ Gate ปัจจุบันหรือการอนุมัติย้อนหลัง',
  ],
}

export const changelog: ChangelogEntry[] = [v1380, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
