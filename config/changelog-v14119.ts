import { changelog as previousChangelog } from './changelog-v14118'
import type { ChangelogEntry } from './changelog'

const current: ChangelogEntry = {
  version: 'v1.41.19',
  date: 'Development History — Feature commit 2026-11-03 10:18:27 +07:00 (ไม่ใช่ Production)',
  changes: [
    'หน้าโอกาสวันนี้และเช็กหุ้นดึงราคาสด Finnhub แบบไม่ใช้แคช และไม่ใช้ราคาที่เก่ากว่าแท่งราคาล่าสุด ป้ายเวลาราคาจากข้อมูลย้อนหลังแสดงเป็นวันซื้อขาย ไม่ใช่เวลาเปิดแท่ง',
    'Scanner จำกัด R:R ที่ 10 และทุกหน้าแสดงค่าตั้งแต่ 10 ขึ้นไปเป็น 10+ และไม่คำนวณเมื่อ Stop ห่างราคาไม่ถึง 0.5% ไม่ติดป้าย Near Support เมื่อหลุดแนวรับสำคัญ ผลหลีกเลี่ยงไม่แสดง R:R เป็นจุดสนับสนุน',
    'ระหว่างตลาดสหรัฐฯ เปิด volume ใช้ session ที่จบแล้วและไม่ใช้ยืนยัน Breakout ของราคาวันนี้ Discovery ใช้สถานะวันประกาศงบเดียวกับ Scanner และ Trending ไม่นับหุ้นที่ไม่ทราบวันประกาศงบ',
    'แปลงสัญลักษณ์หุ้นคลาสสหรัฐฯ เช่น BRK.B เป็นรูปแบบ BRK-B ก่อนส่งให้ Yahoo/Stooq และปรับ prompt ของ AI ให้ใช้ข้อเท็จจริงที่คำนวณแล้ว',
  ],
}

export const changelog: ChangelogEntry[] = [current, ...previousChangelog]
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
