import { changelog as previousChangelog } from './changelog-v14123'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.24',
  date: 'Development History — Feature commit 2026-11-04 09:00:00 +07:00 (ไม่ใช่ Production)',
  changes: [
    'AI Deep Analysis ของ Stock Check ตัดข้อความ AI ที่ขัดกับตัวเลขที่ระบบคำนวณแล้ว (เช่น ราคาต่ำกว่า 52W High แต่ AI เขียนว่าสูงกว่า, ตำแหน่งกลางช่วง 52 สัปดาห์แต่เขียนว่าอยู่ด้านล่าง, ทิศทางเทียบ EMA, และ earnings ที่หมายถึง 60 วันข้างหน้าไม่ใช่ย้อนหลัง) แล้วแจ้งผู้ใช้ว่าตัดไปกี่รายการ',
    'เพิ่มงบโทเค็นของโมเดลหลักและลองโมเดลสำรองเมื่อคำตอบว่าง ถูกตัดกลางคัน หรืออ่านเป็น JSON ไม่ได้ เพื่อลดจำนวนครั้งที่ต้องใช้สรุปสำเร็จรูป และบันทึกสาเหตุที่คำตอบใช้ไม่ได้ลง log',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
