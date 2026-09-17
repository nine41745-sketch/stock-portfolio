import { changelog as previousChangelog } from './changelog-v1272'
import type { ChangelogEntry } from './changelog'

const v1273: ChangelogEntry = {
  version: 'v1.27.3',
  date: '2026-09-18 03:42 ICT',
  changes: [
    'Per-Symbol Freshness: หลัง Auto Sync ซื้อ/ขายหุ้นตัวใด ระบบจะ mark stale เฉพาะหุ้นตัวนั้นจาก holdings.updated_at แทนการทำให้ผล AI ของหุ้นอื่นทั้งพอร์ตต้องวิเคราะห์ใหม่พร้อมกัน',
    'Dime Buying Power: ปุ่มวิเคราะห์ AI แบบ manual และ Daily Portfolio Analysis ใช้ยอดเงินใน Dime เป็นกำลังซื้อหุ้นจริงแทน cash_balance เพื่อให้คำแนะนำขนาดการซื้อสอดคล้องกับเงินที่ Auto Sync หัก/เพิ่มจริง',
    'Trade-Aware Analysis: การวิเคราะห์รายหุ้นอ่าน Auto Sync BUY/SELL ล่าสุดของ symbol เดียวกัน และรวม execution context ไว้ใน analysis fingerprint เพื่อไม่ใช้ผล cache ที่เกิดก่อนธุรกรรมล่าสุด',
    '24h Execution Guard: ถ้าเพิ่ง BUY ผ่าน Auto Sync ภายใน 24 ชั่วโมงแล้ว AI พยายามแนะนำ BUY ซ้ำ ระบบจะพักเป็น HOLD; ถ้าเพิ่ง SELL จะกัน SELL_PARTIAL ซ้ำทันที โดยไม่บล็อก SELL_ALL ที่มีหลักฐาน thesis-breaking ตาม safeguard เดิม',
    'Verification: ทดสอบ Preview ด้วย SOFI จริงแล้ว — การเปลี่ยน SOFI ไม่ลากหุ้นอื่นเป็น stale, การวิเคราะห์ใหม่หลังซื้อแสดง HOLD พร้อม Execution Guard และจำนวนหุ้นตรงกับ Transaction Ledger; ไม่มี SQL หรือ Environment change',
  ],
}

export const changelog: ChangelogEntry[] = [v1273, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
