import { changelog as previousChangelog } from './changelog-v14120'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.22',
  date: 'Development History — Feature commit 2026-11-03 16:01:00 +07:00 (ไม่ใช่ Production)',
  changes: [
    'หน้าพอร์ตแสดงชนิดของ P/E (รายปีหรือ TTM) ข้างตัวเลข เพราะ Finnhub ให้ค่าหลายชนิดและระบบเลือกตามที่มี หุ้นต่างตัวจึงอาจได้คนละชนิดและต่างจากหน้าพื้นฐาน/มูลค่า',
    'หน้าพื้นฐาน/มูลค่าไม่ตัดข้อมูลเพิ่มเติมที่ 60 รายการเรียงตามตัวอักษรอีกต่อไป (เพดานใหม่ 200) ทำให้เห็นฟิลด์ที่เคยถูกตัด เช่น ROE/ROI และอัตราส่วนหนี้ พร้อมจัดกลุ่มผลตอบแทนต่อทุน กระแสเงินสดและเงินปันผล และสภาพคล่อง',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
