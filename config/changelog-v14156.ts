import { changelog as previousChangelog } from './changelog-v14155'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.56',
  date: 'Development History — Feature commit 2026-11-26 20:00:00 +07:00 (ไม่ใช่ Production)',
  changes: [
    'วัดความล่าช้าของข้อมูลราคารายวันที่ใช้คำนวณตัวชี้วัด (RSI/EMA/MACD/แนวรับ ฯลฯ): บันทึกว่า bar ล่าสุดช้ากว่าวันซื้อขายล่าสุดที่ปิดแล้ว ณ เวลาคำนวณกี่วัน (ใช้ปฏิทินตลาดสหรัฐ เวลานิวยอร์ก วันหยุดและวันปิดเร็ว) เก็บไว้ในผลวิเคราะห์ และบันทึกลง log ของ cron รอบหลังตลาดปิดกับรอบก่อนตลาดเปิดเมื่อพบว่าช้า',
    'เป็นการวัดอย่างเดียว ไม่เปลี่ยนค่าตัวชี้วัด คำแนะนำ ถือต่อ/ช้อนเพิ่ม/ขาย กติกา prompt ฐานข้อมูล หรือเวลา cron',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
