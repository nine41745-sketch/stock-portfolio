import { changelog as previousChangelog } from './changelog-v1273'
import type { ChangelogEntry } from './changelog'

const v1274: ChangelogEntry = {
  version: 'v1.27.4',
  date: '2026-09-19 16:02 ICT',
  changes: [
    'Position-Aware Scale-in Guard: Manual AI และ Daily Portfolio Analysis ใช้ policy เดียวกัน — เวลาครบ 24 ชั่วโมงเพียงอย่างเดียวไม่ปลดล็อก BUY ซ้ำอีกต่อไป ต้องมี New Trigger ที่ตรวจจากข้อมูลจริงหลัง Auto Sync BUY ล่าสุด',
    'Deterministic New Trigger: BUY ซ้ำผ่านได้เมื่อราคาขยับจากราคาซื้อจริงมากพอและถึง prior support ใหม่ หรือเกิด breakout/ขาขึ้นต่อเนื่องที่มี Volume + trend/MACD confirmation; มี anti-loop 4 ชั่วโมงและ SELL_ALL ยังคง bypass guard',
    'Portfolio Capacity: deterministic sizing คิด concentration จากมูลค่าหุ้น + เงินใน Dime และใช้เพดาน 30% ให้สอดคล้องกับ Risk heuristic เดิม; position 20%+ อยู่ในโซนเฝ้าระวังและ sizing จะลดขนาดตามกฎเดิม',
    'Audit/Cache Safety: Guard อ่านราคาซื้อจริงจาก Auto Sync Transaction Ledger, Manual/Daily ใช้ shared loader และ Manual cache เก็บ raw AI result เพื่อ re-evaluate guard ทุกครั้งแทนการ cache HOLD ที่เกิดจากเงื่อนไขชั่วคราว',
    'Regression Coverage: ครอบคลุมกรณีแบบ SOFI ที่พ้น 24 ชั่วโมงแต่ไม่มีข้อมูลใหม่ = HOLD, support ใหม่ = BUY, breakout/momentum ใหม่ = BUY, anti-loop <4h = HOLD, concentration 30% = HOLD, repeated SELL_PARTIAL 24h และ SELL_ALL bypass',
  ],
}

export const changelog: ChangelogEntry[] = [v1274, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
