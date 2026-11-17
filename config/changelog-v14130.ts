import { changelog as previousChangelog } from './changelog-v14129'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.30',
  date: 'Development History — Feature commit 2026-11-10 09:43:49 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ตัวตรวจข้อความ AI ในพอร์ตจับประโยคที่บอกทิศทางของราคาเทียบแนวรับผิด เช่น "ราคาต่ำกว่า support 1.59" ทั้งที่ราคา $1.74 สูงกว่าแนวรับ 9.4% (พบใน EOSE ของการวิเคราะห์อัตโนมัติ 10 พ.ย. 2569) และกลับกัน "ราคาเหนือแนวรับ" ทั้งที่ราคาต่ำกว่า โดยเทียบกับแนวรับตัวเดียวกับที่ AI เห็น',
    'ประโยคปฏิเสธ ประโยคเงื่อนไข และ "หลุดแนวรับ" (เพราะแอปมีแนวรับหลายค่า) ไม่ถูกตัด เทสต์ใหม่ใช้ประโยคจริงที่บันทึกไว้ใน Production ยังไม่ได้ทดสอบกับ Groq จริงหลังการแก้',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
