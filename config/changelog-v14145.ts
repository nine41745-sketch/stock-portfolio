import { changelog as previousChangelog } from './changelog-v14144'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.45',
  date: 'Development History — Feature commit 2026-11-18 01:18:36 +07:00 (ไม่ใช่ Production)',
  changes: [
    'เพิ่มเทสต์ของตัวตรวจ security audit ตามที่ผู้ตรวจอิสระของรุ่น v1.41.44 เสนอ: ทดสอบการหมดอายุของข้อยกเว้น picomatch จากนาฬิกาจริงทั้งในตัวตรวจและในคำสั่งที่ CI ใช้ และเพิ่มกรณีที่ต้องไม่ผ่านอีก 9 กรณี เช่น picomatch มีช่องโหว่ตัวที่สอง สายพึ่งพานอกชุด ต้นไม้แพ็กเกจว่างเมื่อ npm ls ล้ม และรายการใน lockfile ที่ไม่ใช่ dev',
    'ตัวตรวจอ่านรหัสช่องโหว่จาก URL ของ GitHub ที่ npm audit รายงานในรูปแบบตรงตัวเท่านั้น ไม่รับโฮสต์อื่น ไม่รับ http ไม่รับข้อความต่อท้าย หรือพารามิเตอร์ ซึ่งทำให้เข้มขึ้นอย่างเดียว ข้อยกเว้น picomatch ยังจำกัดเฉพาะ audit แบบเต็ม เมื่อทุกแพ็กเกจเป็น dev-only และไม่เกิน 2026-12-17 ไม่เปลี่ยน',
    'ไม่เปลี่ยนหน้าจอ API ฐานข้อมูล การวิเคราะห์ AI หรือเวลาการทำงานของ cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
