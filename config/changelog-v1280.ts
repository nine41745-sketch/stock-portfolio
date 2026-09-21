import { changelog as previousChangelog } from './changelog-v1275'
import type { ChangelogEntry } from './changelog'

const v1280: ChangelogEntry = {
  version: 'v1.28.0',
  date: '2026-09-22 03:17 ICT',
  changes: [
    'AI Schedule: คงรอบ Post-close แบบ Full Portfolio Analysis ประมาณ 08:15 น. เวลาไทย และผูกกับวันทำการตลาดสหรัฐ เพื่อไม่สร้าง baseline ในวันหยุดตลาด',
    'Pre-Market Trigger Analysis: เพิ่มรอบก่อนตลาดเปิด 45 นาทีแบบ DST-aware — 19:45 น. ช่วง EDT และ 20:45 น. ช่วง EST — โดยเรียก Groq เฉพาะหุ้นที่มี trigger เพื่อลด token และ rate-limit pressure',
    'Deterministic Triggers: รอบ Pre-market ตรวจ gap ตั้งแต่ ±2%, ข่าวบริษัทใหม่หลัง baseline, Earnings ภายใน 1 วัน และราคาใกล้/แตะ/ทะลุ Support-Resistance ก่อนตัดสินใจเรียก AI',
    'Data Transparency: ใช้ Yahoo Finance pre-market fields พร้อม freshness guard สำหรับราคานอกเวลาทำการ, แสดง source/trigger บน Dashboard และคง Finnhub เป็น fallback เมื่อไม่มีราคา pre-market สด',
    'Track Record Safety: ผล Pre-market บันทึกเป็น latest analysis แยกจาก daily_analyses จึงไม่ปนกับ Post-close Track Record baseline; ไม่มี SQL migration และไม่มี Environment change',
  ],
}

export const changelog: ChangelogEntry[] = [v1280, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
