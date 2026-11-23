import { changelog as previousChangelog } from './changelog-v14152'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.53',
  date: 'Development History — Feature commit (ไม่ใช่ Production)',
  changes: [
    'แก้ปุ่ม "วิเคราะห์ใหม่" บนหน้าคำแนะนำวันนี้ที่กดแล้วเหมือนไม่ทำงานในบางเบราว์เซอร์: เปลี่ยนจากหน้าต่างยืนยันของเบราว์เซอร์เป็นกล่องยืนยันในหน้า (ปุ่ม "ยืนยัน วิเคราะห์ใหม่" / "ยกเลิก" พร้อมบอกจำนวนโควตา AI ที่จะใช้)',
    'วิธีวิเคราะห์ใหม่เหมือนเดิม: ทีละตัว หยุดเมื่อโควตา AI เต็มหรือเซสชันหมดอายุ ไม่เปลี่ยนกติกาการตัดสินใจ ฐานข้อมูล หรือเวลาการทำงานของ cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
