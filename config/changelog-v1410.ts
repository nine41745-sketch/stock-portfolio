import { changelog as previousChangelog } from './changelog-v1402'
import type { ChangelogEntry } from './changelog'

const v1410: ChangelogEntry = {
  version: 'v1.41.0',
  date: 'Unreleased — รอเผยแพร่ Production',
  changes: [
    'ค้นหาโอกาสลงทุน: ปรับคำอธิบายภาษาไทย ปุ่มตามโหมด และการแสดงคะแนน เหตุผล ความสดและขอบเขตข้อมูล',
    'วิเคราะห์ตลาด: จัดส่วนภาพรวมตลาด ข่าว และ Sentiment ให้อ่านง่ายขึ้น รองรับโหมดมืดและสว่าง',
    'แจ้งเตือน: แสดงราคาอ้างอิง แนวรับ ระยะห่าง และเวลาประเมินล่าสุดตามเวลาไทย โดยไม่อ้างว่าเป็นเวลาเกิดเหตุการณ์ครั้งแรก',
    'สแกนหุ้น: อธิบายผลเช็กหุ้นและข้อมูลพื้นฐานให้ชัดเจน แยกผู้เข้ารอบเบื้องต้นสูงสุด 12 ตัวจากการยืนยันอัตโนมัติสูงสุด 6 ตัว และเลือกยืนยันเพิ่มเติมได้',
    'Security Gate และ Production Release Gate: HOLD สำหรับรุ่นนี้ รอการตรวจรับและอนุมัติเผยแพร่',
  ],
}

export const changelog: ChangelogEntry[] = [v1410, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
