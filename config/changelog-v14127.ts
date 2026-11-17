import { changelog as previousChangelog } from './changelog-v14126'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.27',
  date: 'Development History — Feature commit 2026-11-05 11:31:10 +07:00 (ไม่ใช่ Production)',
  changes: [
    'แก้ข้อความ AI ในพอร์ต (ปุ่มวิเคราะห์ AI และการวิเคราะห์อัตโนมัติรอบเช้า/ก่อนตลาดเปิด) ไม่ให้พูดขัดกับตัวเลขที่ระบบคำนวณไว้: ประโยคที่บอกว่าราคาอยู่ที่แนวรับทั้งที่ห่างเกิน 5%, บอกว่าประกาศงบยังไม่ใกล้ทั้งที่เหลือไม่เกิน 7 วัน, เทียบราคากับ EMA ผิด หรือชวนซื้อเพิ่มทั้งที่คำแนะนำสุดท้ายเป็น HOLD จะถูกตัดออก',
    'ถ้าประกาศงบเหลือไม่เกิน 7 วันแต่ข้อความไม่พูดถึงเลย ระบบเติมคำเตือนให้เอง ตัวตรวจทำงานโดยไม่เรียก AI เพิ่ม ทั้งกับผลใหม่และผลที่มาจากแคช และไม่แก้ผลวิเคราะห์ที่บันทึกไว้แล้ว ยังไม่ครอบคลุมกรณี AI เขียนข้อมูลพื้นฐานบริษัทที่ไม่ได้ส่งให้อ่าน (งานค้าง)',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
