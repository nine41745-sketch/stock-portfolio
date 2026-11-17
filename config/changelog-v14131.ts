import { changelog as previousChangelog } from './changelog-v14130'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.31',
  date: 'Development History — Feature commit 2026-11-10 10:23:09 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ตัวตรวจข้อความ AI ในพอร์ตใช้ราคา 52 สัปดาห์สูงสุด/ต่ำสุดที่บันทึกไว้แล้ว จึงตัดประโยคอย่าง "ราคาต่ำกว่า 52-week low" ที่ผิดกับตัวเลขได้ (ก่อนหน้านี้ไม่ได้ส่งค่านี้ให้กฎ จึงไม่เคยตัด) พบจาก EOSE ในการกดวิเคราะห์ 10 พ.ย. 2569',
    'ตัดคำแนะนำซื้อเพิ่มที่ขัดกับผลสุดท้าย HOLD แม้ประโยคจะมี "เมื่อ…" อยู่ท้ายประโยคเพื่ออธิบายเหตุผล (ไม่ใช่เงื่อนไข) และตัดประโยคที่บอกว่า RSI อยู่ในโซน oversold/overbought ทั้งที่ค่า RSI ที่คำนวณไว้ไม่ใช่ โดยไม่ตัดประโยคเงื่อนไข ประโยคปฏิเสธ หรือคำว่า "ใกล้ oversold" ยังไม่ได้ทดสอบกับ Groq จริงหลังการแก้',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
