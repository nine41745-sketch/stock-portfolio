import { changelog as previousChangelog } from './changelog-v1370'
import type { ChangelogEntry } from './changelog'

// Local development candidate only; no merge, deployment or release is implied.
const v1380: ChangelogEntry = {
  version: 'v1.38.0',
  date: 'Unreleased — Release Candidate',
  changes: [
    'Trading Journal แบบ transaction-linked draft-only ในหน่วยความจำ แยกตามพอร์ต โดยไม่เปลี่ยน Ledger และไม่มีความทนทานข้ามการ Reload/อุปกรณ์',
    'Advanced Trade Statistics ใช้หนึ่ง SELL ที่ FIFO ยอมรับเป็นหนึ่งดีล พร้อม Win/Loss/Breakeven, Average Win/Loss, Profit Factor, Expectancy และค่าธรรมเนียมที่บันทึก',
    'FX Profit Attribution แสดง Unavailable เพราะ Transaction Ledger ปัจจุบันไม่มีสกุลเงินหรือ Historical FX Rates; เพิ่มสูตรที่ตรวจสอบได้สำหรับข้อมูลอัตราที่มี Provenance ในอนาคต โดยไม่ประมาณ Spot Rate',
    'ไม่เปลี่ยน Database Schema, Migration, Dependencies, Auth/PIN, Portfolio Isolation หรือ Provider Integrations',
    'Security / Production Release Gate: HOLD — Full Audit 7 High; เวอร์ชันนี้ยัง Unreleased และไม่มีสิทธิ์ Push, Merge, Deploy หรือสร้าง Tag/Release',
  ],
}

export const changelog: ChangelogEntry[] = [v1380, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
