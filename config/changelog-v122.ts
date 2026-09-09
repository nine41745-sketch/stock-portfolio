import { changelog as previousChangelog } from './changelog-v121'
import type { ChangelogEntry } from './changelog'

const v1220: ChangelogEntry = {
  version: 'v1.22.0',
  date: '2026-09-10 03:58 ICT',
  changes: [
    'Performance Workspace: เพิ่มเมนู 📈 ผลงาน พร้อม Market Value, Total P/L, Realized P/L แบบ FIFO, Unrealized P/L, Dividend, Win Rate, Best/Worst Trade และผลลัพธ์แยกรายหุ้น',
    'Ledger Reconciliation: ใช้ OPENING_POSITION + BUY - SELL ตรวจเทียบจำนวนหุ้นกับ Holdings พร้อม Data Quality warning เมื่อข้อมูลไม่ตรง โดย Performance เป็น Read-only และไม่แก้ Holdings/Transaction อัตโนมัติ',
    'Historical Performance: เพิ่ม Equity / P&L Curve แบบ 1M / YTD / 1Y / ALL ด้วย historical market data แยกจาก indicator เดิม พร้อม SPY reference benchmark และจำกัด lookback เพื่อควบคุมโหลด',
    'Existing Portfolio Baseline: รองรับการเริ่มวัดผลจากยอดหุ้นตั้งต้นและ Cost Basis จริงโดยไม่สร้าง BUY ย้อนหลังปลอม; Preview ยืนยัน Ledger ตรง Holdings ก่อน finalize release',
    'Regression Safety: เพิ่ม Performance regression gate และคง Portfolio AI, Scanner, Daily Cron, Track Record, Holdings writes และ Transaction writes เดิมไว้โดยไม่เปลี่ยน รวมทั้งไม่มี SQL migration ใหม่ใน release นี้',
  ],
}

export const changelog: ChangelogEntry[] = [v1220, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
