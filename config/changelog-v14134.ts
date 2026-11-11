import { changelog as previousChangelog } from './changelog-v14133'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.34',
  date: 'Development History — Feature commit 2026-11-11 23:59:04 +07:00 (ไม่ใช่ Production)',
  changes: [
    'หน้า ศูนย์รวมการลงทุน แสดงเวอร์ชันปัจจุบันของแอปแทนข้อความ "v1.40.0 RC" ที่ค้างอยู่ และการ์ด Allocation Targets แสดงเป้าหมายครบทุกรายการ (เดิมตัดเหลือ 8 รายการ ทำให้ SPCX และเงินสด DIME หายไป) พร้อมบอกจำนวนที่เหลือเมื่อเกิน 20 รายการ',
    'ราคาสูงสุด 52 สัปดาห์ของหุ้นที่ร่วงแรงไม่ถูกตัดทิ้งอีกต่อไป (เช่น EOSE ที่ราคา $1.98 แต่ high จริง $19.65) เดิมระบบตัดค่า high ที่เกิน 5 เท่าของราคาเพราะกลัวข้อมูลผิดสกุลเงิน ตอนนี้ตัดเฉพาะเกิน 25 เท่า (ผิดสกุล USD/THB ประมาณ 33 เท่ายังถูกตัด) และถ้าราคาต่ำสุด 52 สัปดาห์สูงกว่าราคาปัจจุบันเกิน 1.5 เท่า (เป็นไปไม่ได้ในข้อมูลจริง แปลว่าช่วงราคาทั้งชุดอยู่คนละสกุล เช่น หุ้น ADR ที่เป็น DKK/SEK/MXN) จะตัดทั้งราคาต่ำสุดและสูงสุดทิ้งคู่กัน ค่าที่ส่งให้ AI ในปุ่มวิเคราะห์และ cron จึงมี 52 สัปดาห์สูงสุดของหุ้นเหล่านี้ ยังไม่ได้ทดสอบกับข้อมูลจริงจาก Finnhub หลังแก้',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
