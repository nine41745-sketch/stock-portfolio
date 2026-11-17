import { changelog as previousChangelog } from './changelog-v14122'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.23',
  date: 'Development History — Feature commit 2026-11-03 23:30:00 +07:00 (ไม่ใช่ Production)',
  changes: [
    'หน้าพื้นฐาน/มูลค่าบอกว่า "ไม่พบนัดประกาศผลใน 60 วันข้างหน้า" เมื่อ Finnhub ตอบสำเร็จแต่ไม่มีรายการในช่วงนั้น แทนข้อความ "ไม่มีข้อมูลในแหล่งนี้" ที่ทำให้เข้าใจว่าข้อมูลหาย ส่วนกรณีผู้ให้บริการขัดข้องหรือเกินโควตายังแสดงสถานะเดิม และการอ่านปฏิทินประกาศผลใช้ค่า 60 วันชุดเดียวกัน',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
