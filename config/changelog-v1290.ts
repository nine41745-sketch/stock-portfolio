import { changelog as previousChangelog } from './changelog-v1280'
import type { ChangelogEntry } from './changelog'

const v1290: ChangelogEntry = {
  version: 'v1.29.0',
  date: '2026-09-23 16:42 ICT',
  changes: [
    'All-Time High (ATH): เพิ่มข้อมูล ATH จากประวัติ Yahoo Finance สูงสุดที่มี พร้อมสถานะ ATH / ใกล้ ATH ≤ 3% โดยไม่ใช้ 52W High แทน ATH และไม่เปลี่ยนคะแนน Scanner หรือคำแนะนำ AI',
    'Scanner: เพิ่มคอลัมน์ ATH และแนวรับสำคัญ พร้อม Filter/Sort สำหรับหุ้นใกล้ ATH และใกล้/หลุดแนวรับสำคัญ เพื่อหา Price Location ที่ต้องติดตามได้เร็วขึ้น',
    'Important Support: เพิ่มแนวรับสำคัญแบบ deterministic จาก swing low ที่เกิดซ้ำอย่างน้อย 2 ครั้งในโซน ±1.5% ภายในข้อมูล completed sessions สูงสุด 120 วัน; ใกล้แนวรับ = ภายใน 3% และแยกสถานะหลุดแนวรับชัดเจน',
    'Dashboard: เพิ่ม badge 🏆 ATH, ใกล้ ATH, 🛡️ ใกล้แนวรับสำคัญ และ ⚠️ หลุดแนวรับสำคัญ โดยซ่อนข้อความห่าง ATH ที่ไกลเกิน 3% เพื่อลดข้อมูลรบกวนและเน้นเฉพาะสถานะที่ actionable',
    'Alerts: เพิ่ม ATH และ Important Support alerts แบบ read-only derived alerts; ATH เป็น INFO, ใกล้แนวรับสำคัญเป็น WARNING และหลุดแนวรับสำคัญเป็น CRITICAL โดยไม่มี SQL migration และไม่มี Environment change',
  ],
}

export const changelog: ChangelogEntry[] = [v1290, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
