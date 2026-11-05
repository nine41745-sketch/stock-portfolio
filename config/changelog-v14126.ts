import { changelog as previousChangelog } from './changelog-v14125'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.26',
  date: 'Development History — Feature commit 2026-11-05 07:56:26 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ถอดข้อยกเว้นของ braces (GHSA-vfj7-8cjw-p6xm) ออกจากตัวตรวจ security audit เพราะ GitHub ถอนประกาศช่องโหว่นี้แล้วเมื่อ 2026-10-23 และ npm audit ไม่รายงาน braces อีก ตัวตรวจจึงไม่ต้องมีโค้ดข้อยกเว้นที่ไม่ได้ใช้',
    'รายงาน audit ที่มีรูปแบบ braces แบบเดิมจะถูกจัดเป็น FINDINGS (ล้ม CI) ทุกกรณี พร้อมเทสต์ลบยืนยัน ส่วนข้อยกเว้น minimatch และเงื่อนไขอื่นของตัวตรวจไม่เปลี่ยน และแก้ข้อความใน CI ให้ไม่ชี้ไปเอกสาร braces ที่ปิดแล้ว',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
