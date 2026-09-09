import { changelog as previousChangelog } from './changelog-v1181'
import type { ChangelogEntry } from './changelog'

const v1190: ChangelogEntry = {
  version: 'v1.19.0',
  date: '2026-09-09 23:10 ICT',
  changes: [
    'Dedicated Scanner: แยกหน้า /scanner ออกจาก Dashboard พร้อมแท็บ Portfolio / Scanner และรวม Scanner + Watchlist ใน workspace เดียว',
    'Scanner Upgrade: เพิ่ม Setup Classification, Filter/Sort, EMA50/200, RSI Day/Week, MACD, 52W range, Earnings Risk, Relative Strength vs SPY และ Risk:Reward',
    'Technical Accuracy: แก้ Breakout ให้ใช้แนวรับ/แนวต้านจากแท่งก่อนหน้า และแก้ Volume Ratio ให้ค่าเฉลี่ย 20 วันไม่รวมวันปัจจุบัน โดยไม่เปลี่ยนสูตรเดิมของ AI/Portfolio',
    'Theme Persistence: โหมดสว่าง/มืดจำค่าหลัง Refresh และใช้ค่าเดียวกันระหว่าง Dashboard กับ Scanner',
    'Data Safety: ไม่มี SQL migration ใหม่ ไม่เปลี่ยน holdings, cost basis, cash, Dime, Supabase schema/RLS หรือ PIN/Auth',
  ],
}

export const changelog: ChangelogEntry[] = [v1190, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
