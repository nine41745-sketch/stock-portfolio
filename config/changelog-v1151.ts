import { changelog as previousChangelog } from './changelog-v115'
import type { ChangelogEntry } from './changelog'

const v1151: ChangelogEntry = {
  version: 'v1.15.1',
  date: '2026-09-06 00:25 ICT',
  changes: [
    'Security maintenance: อัปเกรด Next.js จาก 14.2.16 เป็น 15.5.24 (Maintenance LTS) และย้าย React/React DOM เป็น 19.2.8 ตามข้อกำหนดของ Next.js 15 เพื่อลดความเสี่ยงจากช่องโหว่ของ framework รุ่นเก่า',
    'เพิ่ม server-side validation กลางสำหรับ symbol, holding id, จำนวนหุ้น, ต้นทุนเฉลี่ย, เงินในธนาคาร, Dime และเงินต้น: ปฏิเสธค่าติดลบ, NaN/Infinity, ชนิดข้อมูลผิด และค่าที่เกินขอบเขต column ก่อนถึงฐานข้อมูล',
    'เพิ่ม Data Integrity migration: CHECK constraints ที่ holdings/user_settings และ FK manual_latest_analyses -> holdings แบบ ON DELETE CASCADE พร้อมเก็บกวาด orphan manual analysis เดิมก่อนเพิ่ม constraint',
    'แก้ false-success ของช่องเงินสด/Dime/เงินต้น: PUT /api/user-settings ที่ตอบ 4xx/5xx จะเข้า catch path เดิมของ Dashboard แทนการแสดงว่าบันทึกสำเร็จทั้งที่ server ปฏิเสธ',
    'ลดการเปิดเผย error ภายในจาก holdings/user-settings API โดย log รายละเอียดฝั่ง server และส่งข้อความทั่วไปกลับ client; GET user_settings เปลี่ยนเป็น maybeSingle เพื่อแยกกรณียังไม่มี row ออกจาก query failure',
  ],
}

export const changelog: ChangelogEntry[] = [v1151, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
