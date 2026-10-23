import { changelog as previousChangelog } from './changelog-v1400'
import type { ChangelogEntry } from './changelog'

// Prepared release-candidate metadata; deployment date and release status must be set from verified release evidence.
const v1401: ChangelogEntry = {
  version: 'v1.40.1',
  date: 'Unreleased — Release Candidate',
  changes: [
    'หน้าใส่ PIN แสดงชื่อ “ระบบจัดการหุ้น” แทนชื่อพอร์ตเดิม',
    'แยกธุรกรรมบันทึกทั่วไปออกจากรายการซื้อ/ขายจริง ปรับการบันทึกและการแก้รายการให้สื่อสถานะชัดเจน และจัดประวัติยาวให้อยู่ในพื้นที่เลื่อนพร้อมหัวตารางที่มองเห็นได้',
    'หน้าผลงานแยกความหมายของ Win Rate สัญญาณ AI ออกจากผลซื้อขายจริงที่คำนวณตาม FIFO เพื่อไม่ให้ตัวเลข 90% ถูกเข้าใจว่าเป็นอัตราชนะจากการซื้อขายจริง',
    'ซ่อนการแก้/ลบโดยตรงของรายการซื้อขายจริง; การแก้รายการล่าสุดที่รองรับใช้กระบวนการ Atomic พร้อมตรวจยอดและบันทึก audit โดยติดตั้ง Migration บน Production แล้ว แต่รายการเก่าที่ไม่มี snapshot ยังแก้ผ่านวิธีนี้ไม่ได้ และยังรออนุมัติเผยแพร่แอป',
    'ย้ายข้อความแจ้งผลการทำรายการไปมุมล่างขวา เพื่อลดการบังข้อมูลบริเวณด้านบนของหน้า',
    'เพิ่มความละเอียดการกรอกต้นทุนเป็นทศนิยมสูงสุด 6 ตำแหน่ง โดยคงความละเอียดของยอด DIME ตามฐานข้อมูลเดิม',
    'Release Gate: HOLD — ติดตั้ง Migration แล้ว การเผยแพร่แอปยังต้องได้รับอนุมัติแยก และยังไม่กำหนดวัน Release',
  ],
}

export const changelog: ChangelogEntry[] = [v1401, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
