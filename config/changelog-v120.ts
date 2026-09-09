import { changelog as previousChangelog } from './changelog-v119'
import type { ChangelogEntry } from './changelog'

const v1200: ChangelogEntry = {
  version: 'v1.20.0',
  date: '2026-09-10 00:48 ICT',
  changes: [
    'Stock Check: เพิ่มแท็บเช็กหุ้นรายตัวใน Scanner เพื่อวิเคราะห์หุ้น US ใดก็ได้โดยไม่ต้องเพิ่มเข้า Portfolio ก่อน',
    'Deterministic Trade Plan: เพิ่ม BUY NOW / BUY ON PULLBACK / WAIT FOR BREAKOUT / WATCH / AVOID พร้อม Entry Zone, Stop Loss, Target 1/2 และ Risk:Reward',
    'Risk Planning: เพิ่ม ATR14 แบบแยกจาก Portfolio AI เพื่อช่วยวาง Stop ตาม volatility พร้อม Position Sizing จากงบที่กำหนด',
    'Market Context: ใช้แนวรับ/แนวต้านและ Volume แบบ scanner-safe, Relative Strength เทียบ SPY, P/E, 52W range และ Earnings Risk',
    'Optional AI: เพิ่มการวิเคราะห์เชิงลึกด้วย AI เป็นขั้นเสริม โดยไม่ให้ AI เปลี่ยนระดับราคาและคำตัดสิน deterministic',
    'Data Safety: ไม่มี SQL migration ใหม่ ไม่แก้ Holdings และไม่เปลี่ยน logic AI/Track Record/Daily Cron เดิมของ Portfolio',
  ],
}

export const changelog: ChangelogEntry[] = [v1200, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
