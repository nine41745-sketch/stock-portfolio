import { changelog as previousChangelog } from './changelog-v1151'
import type { ChangelogEntry } from './changelog'

const v1160: ChangelogEntry = {
  version: 'v1.16.0',
  date: '2026-09-06 02:14 ICT',
  changes: [
    'AI Freshness: เก็บเวลาเปลี่ยน shares/ต้นทุน/องค์ประกอบพอร์ตและเงินสดฝั่งฐานข้อมูล แล้วเตือนแบบคงอยู่ข้าม Refresh/PIN Lock/Logout เมื่อผล AI ล่าสุดเก่ากว่าสถานะพอร์ตปัจจุบัน; วิเคราะห์ใหม่แล้วสถานะของหุ้นนั้นกลับเป็นปัจจุบัน',
    'News Reliability: รวมกติกา relevance เป็น helper เดียวสำหรับ Manual Analyze, Daily Cron และหน้า News พร้อม positive target check, META aliases (Instagram/WhatsApp/Zuckerberg), boundary matching และกัน ticker ที่เป็นคำทั่วไปอย่าง NOW/ARM/NET เกิด false positive',
    'Timezone/UX: เวลา “วิเคราะห์เมื่อ” บังคับแสดง Asia/Bangkok (ICT) และแก้ข้อความ Track Record ให้ตรง Cron จริงประมาณ 08:15 น. โดยไม่เปลี่ยนตาราง Cron 01:15 UTC',
    'Documentation: อัปเดต SETUP/DEPLOY/.env example ให้ตรง Next.js 15, Groq, PIN session, Cron และ release workflow ปัจจุบัน โดยไม่ใส่ secret จริง',
    'Regression Safety: เพิ่ม npm test:critical และให้ Production build รัน critical tests อัตโนมัติก่อน next build ครอบคลุม validation, news relevance, latest-wins, freshness และ Cron schedule',
    'คง PIN-only inactivity lock, SELL_ALL deterministic safeguard, daily history และ newest analysedAt wins เดิมไว้ ไม่เปลี่ยน Decision Framework หรือ Production Cron schedule',
  ],
}

export const changelog: ChangelogEntry[] = [v1160, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
