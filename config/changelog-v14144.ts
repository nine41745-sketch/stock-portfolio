import { changelog as previousChangelog } from './changelog-v14143'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.44',
  date: 'Development History — Feature commit 2026-11-18 00:40:35 +07:00 (ไม่ใช่ Production)',
  changes: [
    'ตัวตรวจ security audit ล้มทุกครั้งเพราะพบช่องโหว่ใหม่ของ picomatch (GHSA-fc5q-39xc-vjpf ระดับ high เป็นช่องโหว่แบบ ReDoS ในการจับคู่ไฟล์) ซึ่งยังไม่มีรุ่นที่แก้ (รุ่นล่าสุด 4.0.7 อยู่ในช่วงที่ได้รับผลกระทบ) ช่องโหว่นี้อยู่ในเครื่องมือพัฒนาเท่านั้น (tailwindcss, ESLint) ส่วนที่ผู้ใช้เปิดบน Production ไม่ได้รับผลกระทบ และ audit เฉพาะ Production ผ่านโดยไม่มีข้อยกเว้น',
    'เพิ่มข้อยกเว้นชั่วคราวที่ระบุเฉพาะช่องโหว่นี้ตัวเดียว: ใช้ได้เฉพาะ audit แบบเต็ม เมื่อทุกแพ็กเกจในสายพึ่งพาเป็น dev-only, npm audit คืนรหัส 1 และวันที่ไม่เกิน 2026-12-17 ถ้ามีช่องโหว่อื่น ระดับอื่น แพ็กเกจที่ใช้ตอนรันจริง หรือเกินวันหมดอายุ ตัวตรวจจะไม่ผ่านทันที',
    'ต้องลบข้อยกเว้นนี้เมื่อมี picomatch รุ่นที่แก้แล้วและเครื่องมือพัฒนาใช้รุ่นนั้น ไม่เปลี่ยนหน้าจอ API ฐานข้อมูล การวิเคราะห์ AI หรือเวลาการทำงานของ cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
