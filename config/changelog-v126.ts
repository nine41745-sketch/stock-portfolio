import { changelog as previousChangelog } from './changelog-v1251'
import type { ChangelogEntry } from './changelog'

const v126: ChangelogEntry = {
  version: 'v1.26.0',
  date: '2026-09-13 02:10 ICT',
  changes: [
    'Decision Engine: ปรับ Stock Check ให้แยก WAIT/WATCH ออกจาก AVOID ด้วย evidence-based gates และคง STANDARD BUY_NOW แบบเข้มงวด',
    'First Tranche: เพิ่ม FIRST_TRANCHE สำหรับ controlled dip/ไม้แรก เมื่อโครงสร้างระยะกลางยังดี พร้อม guard เรื่อง earnings, overextension และ risk/reward',
    '52-Week Sanity: เพิ่มการตรวจและ sanitize ช่วง 52-week high/low เพื่อลดความผิดเพี้ยนจาก provider/listing scale',
    'Today Opportunities: เพิ่ม 🔥 โอกาสซื้อวันนี้ โดยสแกนหลาย universe แบบ deterministic และ revalidate ผู้เข้ารอบด้วย Stock Check',
    'Global Controls: ทำ Theme / Change PIN / Lock / Logout ให้เข้าถึงได้แบบ global โดยรักษา flow ความปลอดภัยเดิม',
    'AI Routing: Deep Stock Check ใช้โมเดลหลัก openai/gpt-oss-120b พร้อม high reasoning และ fallback openai/gpt-oss-20b โดยไม่ยกระดับทุกงานให้ใช้โมเดลหนัก',
    'Regression Coverage & Safety: เพิ่ม regression สำหรับ decision gates, FIRST_TRANCHE, 52-week sanity, global controls และ Today Opportunities; release นี้ไม่มี Supabase Migration/SQL หรือ Environment change และไม่แก้ holdings/transactions/trade plan อัตโนมัติ',
  ],
}

export const changelog: ChangelogEntry[] = [v126, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
