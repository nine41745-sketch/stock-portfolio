import { changelog as previousChangelog } from './changelog-v14142'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.43',
  date: 'Development History — Feature commit 2026-10-23 17:56:21 +07:00 (ไม่ใช่ Production)',
  changes: [
    'เพิ่มชุดทดสอบแบบเลือกใช้สำหรับการแก้ไขธุรกรรมแบบ atomic: ทดสอบบนฐานข้อมูลจำลองในเครื่องที่ตั้งโครงสร้างให้ตรงกับที่เคยสังเกตจาก catalog จริง (ตัวเลขทศนิยมไม่จำกัดและค่า NULL) ครอบคลุมค่าทศนิยมตรงตัว ค่า NULL การลบบัญชี และการ rollback ก่อนใช้งานจริง',
    'ชุดทดสอบนี้ไม่ทำงานเอง ต้องตั้งค่าเปิดใช้ในเครื่องที่มี Docker เท่านั้น และใช้ข้อมูลสังเคราะห์ ไม่เชื่อมต่อฐานข้อมูลจริงหรือ Production',
    'ไม่เปลี่ยนหน้าจอ API ฐานข้อมูลจริง การวิเคราะห์ AI หรือเวลาการทำงานของ cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
