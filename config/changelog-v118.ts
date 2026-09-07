import { changelog as previousChangelog } from './changelog-v117'
import type { ChangelogEntry } from './changelog'

const v118: ChangelogEntry = {
  version: 'v1.18.0',
  date: '2026-09-08 04:54 ICT',
  changes: [
    'Stock Scanner: เพิ่มระบบสแกนหุ้นแบบ deterministic สำหรับกลุ่มหุ้น US ที่คัดไว้ รวมถึงหุ้นในพอร์ต/Watchlist พร้อมจำกัด provider fan-out เพื่อลดการใช้ quote และ technical-data requests',
    'Watchlist: เพิ่มรายการหุ้นที่เล็งเข้าซื้อแบบ per-user พร้อมราคาเป้าหมายและหมายเหตุ โดยใช้ authenticated RLS และ migration แบบไม่ทำลายข้อมูลเดิม',
    'Light Mode: ปรับ semantic text, status และ supporting copy ให้มี contrast อ่านง่ายขึ้นบนพื้นหลังโหมดสว่าง',
    'Sold-stock Freshness: หุ้นที่ขายหมดหรือ shares = 0 จะไม่ขึ้น stale-AI warning บน Dashboard อีก แต่ยังคงประวัติการวิเคราะห์ไว้สำหรับ Track Record',
  ],
}

export const changelog: ChangelogEntry[] = [v118, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
