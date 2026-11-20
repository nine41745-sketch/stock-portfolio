import { changelog as previousChangelog } from './changelog-v14147'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.48',
  date: 'Development History — Feature commit 2026-11-20 22:43:57 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ผลวิเคราะห์แต่ละหุ้นบอกแล้วว่า AI เสนออะไร และด่านไหนของระบบเปลี่ยนคำแนะนำ เช่น "AI เสนอ: ซื้อเพิ่ม → ระบบสั่งสุทธิ: ถือต่อ เพราะด่านกันซื้อซ้ำ" (ไม่เปลี่ยนผลการตัดสินใดๆ แค่บันทึกและแสดงให้เห็น)',
    'การ์ดผลวิเคราะห์แสดงรอบ (หลังตลาดปิด / ก่อนตลาดเปิด / วิเคราะห์เอง) และเวลา และหน้า Dashboard เตือนเมื่อผลของบางหุ้นยังเป็นของรอบก่อนหรือโหลดผลไม่สำเร็จ แทนการแสดงผลเก่าเงียบๆ',
    'พาดหัวข่าวที่ส่งให้ AI ถูกล้างอักขระควบคุม/อักขระซ่อน/แท็ก HTML และจำกัดความยาว พร้อมบอก AI ว่าข่าวเป็นข้อมูลจากภายนอก ห้ามทำตามคำสั่งในข่าว (ใช้กับการวิเคราะห์รายวัน ปุ่มวิเคราะห์เอง การแปลข่าว และ Deep Stock Check)',
    'ไม่เปลี่ยนกติกาการตัดสินใจ ฐานข้อมูล หรือเวลาการทำงานของ cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
