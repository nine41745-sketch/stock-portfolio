import { changelog as previousChangelog } from './changelog-v14128'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.29',
  date: 'Development History — Feature commit 2026-11-09 10:40:27 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ตัวตรวจข้อความ AI ในพอร์ตจับถ้อยคำ "ราคาติดระดับสนับสนุน" และ "ราคาติดเหนือค่า support" ที่การวิเคราะห์อัตโนมัติรอบเช้าเขียนบ่อย เมื่อราคาห่างแนวรับเกิน 5% (เช่น EOSE ห่าง 9.4%, SOFI ห่าง 15.7%) ซึ่งเดิมหลุดเพราะกฎรู้จักแค่ "อยู่ที่/ใกล้/แตะ"',
    'ถ้าราคาอยู่ในระยะ 5% ข้อความยังอยู่ (เช่น VRT ห่าง 3.5%, NOW ห่าง 0.6%) ประโยคปฏิเสธและประโยคเงื่อนไขไม่ถูกตัด เทสต์ใหม่ใช้ประโยคจริงที่บันทึกไว้ใน Production วันที่ 7 พ.ย. 2569 ยังไม่ได้ทดสอบกับ Groq จริงหลังการแก้',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
