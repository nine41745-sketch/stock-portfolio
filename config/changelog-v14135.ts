import { changelog as previousChangelog } from './changelog-v14134'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.35',
  date: 'Development History — Feature commit 2026-11-12 09:44:03 +07:00 (ไม่ใช่ Production)',
  changes: [
    'หน้าแรกเติมราคาสูงสุด/ต่ำสุด 52 สัปดาห์ที่ผู้ให้บริการราคา (Finnhub) ไม่ส่งมาด้วยค่าที่คำนวณจากแท่งราคารายวัน (ชุดเดียวกับที่ใช้วิเคราะห์ AI) เช่น หุ้น ADR ที่เดิมแสดง "—–—" ระบบใช้ค่าจาก Finnhub ก่อน เติมเฉพาะช่องที่ขาด และตรวจความสมเหตุสมผลกับราคาปัจจุบันเหมือนเดิม เติมทั้งตอนเปิดหน้าแรกและตอนกดรีเฟรชราคา ดึงแท่งราคาเฉพาะหุ้นที่ขาดและมีราคา ไม่เกิน 5 ตัวต่อครั้ง รอไม่เกิน 4 วินาทีต่อหุ้น (จำค่าที่ได้ไว้ในหน่วยความจำ 6 ชั่วโมง) ถ้าดึงไม่ได้ก็แสดงว่างเหมือนเดิม และไม่แสดงช่วงราคาที่กลับด้าน (สูงสุดต่ำกว่าต่ำสุด) ค่าที่ส่งให้ AI ในปุ่มวิเคราะห์และ cron ไม่เปลี่ยน ยังไม่ได้ทดสอบกับข้อมูลจริงหลังแก้',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
