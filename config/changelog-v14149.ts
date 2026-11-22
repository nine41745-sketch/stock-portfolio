import { changelog as previousChangelog } from './changelog-v14148'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.49',
  date: 'Development History — Feature commit (ไม่ใช่ Production)',
  changes: [
    'Track Record แสดงสรุป "AI เสนอ vs ระบบสั่ง" ว่าในช่วง 7/30 วันระบบเปลี่ยนคำแนะนำของ AI กี่ครั้งและเพราะด่านไหน (นับเฉพาะผลตั้งแต่ v1.41.48)',
    'แบนเนอร์ความสดของผลนับเฉพาะหุ้นที่ยังถืออยู่ บอกหุ้นที่ถืออยู่แต่ยังไม่มีผลวิเคราะห์ และวันที่ของผลที่กดวิเคราะห์เองใช้เวลาของผลจริง (ผลที่ล้มไม่ล้างคำเตือน)',
    'ผลรอบหลังตลาดปิดรุ่นเก่าที่ไม่มีป้ายรอบแสดงเป็น "รอบหลังตลาดปิด" แทน "วิเคราะห์เอง"',
    'Deep Stock Check เมื่อไม่ได้รับข่าวจะบอก AI ว่า "ระบบไม่ได้รับข่าว" แทน "ไม่มีข่าวสำคัญ" ให้ตรงกติกาการอ้างข้อมูล',
    'ลบโค้ดวิเคราะห์รุ่นเก่าที่ไม่มีใครเรียกใช้ และแก้คอมเมนต์เรื่องแคชให้ตรงกับการทำงานจริง',
    'ไม่เปลี่ยนกติกาการตัดสินใจ ฐานข้อมูล หรือเวลาการทำงานของ cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
