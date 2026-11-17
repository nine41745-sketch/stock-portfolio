import { changelog as previousChangelog } from './changelog-v14127'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.28',
  date: 'Development History — Feature commit 2026-11-05 13:12:10 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ตัวตรวจข้อความ AI ในพอร์ตจับถ้อยคำที่เจอใน Production เพิ่ม: "การซื้อเพิ่ม…จึงเหมาะสม/น่าสนใจ" ที่ขัดกับคำแนะนำถือต่อ, "ใกล้ระดับสนับสนุน" ที่ราคาห่างเกิน 5%, และไม่เติมคำเตือนประกาศงบซ้ำเมื่อข้อความ AI พูดถึง "ผลประกอบการที่ใกล้เข้ามา" อยู่แล้ว',
    'ประโยคเงื่อนไข ประโยคปฏิเสธ และข้อความที่ถูกต้องยังคงอยู่ เทสต์ใหม่ใช้ประโยคจริงจากผลวิเคราะห์ RKLB และ EOSE ของวันที่ 5 พ.ย. 2569 ยังไม่ได้ทดสอบกับ Groq จริงหลังการแก้',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
