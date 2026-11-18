import { changelog as previousChangelog } from './changelog-v14146'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.47',
  date: 'Development History — Feature commit 2026-11-18 12:00:00 +07:00 (ไม่ใช่ Production)',
  changes: [
    'งบซื้อที่ใช้วิเคราะห์หุ้นเปลี่ยนจากเงินสด DIME อย่างเดียวเป็น เงินสด DIME + เงินในธนาคาร ทั้งรอบ cron หลังตลาดปิด, รอบ pre-market และปุ่มวิเคราะห์ AI ใน Dashboard เพื่อให้ BUY ไม่ถูกปรับเป็น HOLD ทั้งที่เงินรวมพอช้อน (เงินในธนาคารอาจต้องโอนเข้า DIME ก่อนซื้อจริง)',
    'ข้อความเมื่อเงินไม่พอเปลี่ยนเป็น "เงินที่พร้อมใช้ (Dime + เงินในธนาคาร)" และกฎอื่น (เพดาน concentration, ขั้นต่ำ 5%, แชร์งบระหว่างหลาย BUY, Execution Guard) ไม่เปลี่ยน; ฟีเจอร์ Smart DCA/Smart Dip/Risk/Performance ยังใช้ยอดของตัวเอง',
    'ไม่เปลี่ยนฐานข้อมูล เวลาการทำงานของ cron หรือหน้าจออื่น',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
