import { changelog as previousChangelog } from './changelog-v14153'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.54',
  date: 'Development History — Feature commit 2026-11-24 10:47:59 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ปรับกล่องยืนยันของปุ่ม "วิเคราะห์ใหม่" บนหน้าคำแนะนำวันนี้ตามข้อสังเกตของผู้ตรวจ: กล่องยืนยันปิดเสมอเมื่อกด "ยืนยัน" (ไม่ค้างแม้ไม่มีหุ้นหรือกำลังวิเคราะห์อยู่) และโฟกัสคีย์บอร์ดไม่หลุดหลังเริ่มวิเคราะห์ (ย้ายไปที่พื้นที่ทำงานของหน้าแทนปุ่มที่ถูกปิดใช้งาน)',
    'วิธีวิเคราะห์เหมือนเดิม: ทีละตัว หยุดเมื่อโควตา AI เต็มหรือเซสชันหมดอายุ ไม่เปลี่ยนกติกาการตัดสินใจ ฐานข้อมูล หรือเวลาการทำงานของ cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
