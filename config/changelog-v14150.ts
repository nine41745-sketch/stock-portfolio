import { changelog as previousChangelog } from './changelog-v14149'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.50',
  date: 'Development History — Feature commit 2026-11-22 09:39:21 +07:00 (ไม่ใช่ Production)',
  changes: [
    'บันทึกสถานะรอบวิเคราะห์อัตโนมัติ (รอบหลังตลาดปิดและรอบก่อนตลาดเปิด) ต่อพอร์ต: เวลาเริ่ม/จบ จำนวนที่สำเร็จ ไม่สำเร็จ และติดโควตา AI',
    'หน้า Dashboard เตือนเมื่อรอบวิเคราะห์รายวันล่าสุดวิเคราะห์ไม่สำเร็จบางตัวหรือทั้งหมด แทนการแสดงผลของรอบก่อนเงียบๆ',
    'รอบก่อนตลาดเปิดบันทึกข้อผิดพลาดที่เคยเงียบไว้ใน log',
    'ต้องรัน migration ฐานข้อมูลแยกต่างหากก่อนจึงจะเริ่มบันทึกสถานะ ระหว่างนี้ระบบทำงานเหมือนเดิม',
    'ไม่เปลี่ยนกติกาการตัดสินใจหรือเวลาการทำงานของ cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
