import { changelog as previousChangelog } from './changelog-v1312'
import type { ChangelogEntry } from './changelog'

const v1320: ChangelogEntry = {
  version: 'v1.32.0',
  date: '2026-10-11 03:54 ICT',
  changes: [
    'Market Intelligence: เพิ่มหน้าใหม่สำหรับสรุปตลาด SPY/QQQ และ AI Market Brief แบบผู้ใช้กดสร้างเอง ด้วย Groq ที่ตั้งค่าอยู่แล้ว',
    'Portfolio News Impact: ใช้ Finnhub/Groq จาก News API เดิม แสดงข่าวเกี่ยวกับหุ้นที่ถือในพอร์ตปัจจุบัน พร้อมแหล่งข่าวและการตีความบวก/ลบ/กลาง',
    'Sentiment Trend 7/30 วัน: วิเคราะห์หัวข้อข่าวไม่ซ้ำจากผล Daily AI ที่บันทึกไว้ แสดงจำนวนตัวอย่าง LOW เป็นข้อมูลไม่จำแนก และระบุชัดว่าเป็นวันที่วิเคราะห์ไม่ใช่วันข่าว',
    'API ใช้ Auth + Portfolio Isolation + อ่านข้อมูลแบบ read-only ไม่มี Migration/Environment ใหม่ ไม่มีซื้อขายอัตโนมัติ',
    'รองรับมือถือ โหมดมืดและสว่าง พร้อม Empty/Error/Quota states และ Regression Tests',
  ],
}

export const changelog: ChangelogEntry[] = [v1320, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
