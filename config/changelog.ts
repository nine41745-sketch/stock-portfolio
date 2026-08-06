// ============================================================
// Changelog — ประวัติการอัปเดตระบบ "พอร์ตน้องเจน"
// เพิ่มเวอร์ชันใหม่โดยแทรกรายการใหม่ไว้ "บนสุด" ของ array นี้ (เรียงใหม่สุด -> เก่าสุด)
// CURRENT_VERSION ด้านล่างจะดึงจากรายการแรกให้อัตโนมัติ ไม่ต้องแก้ 2 ที่
// ============================================================

export interface ChangelogEntry {
  version: string
  date: string   // YYYY-MM-DD HH:MM ICT
  changes: string[]
}

export const changelog: ChangelogEntry[] = [
  {
    version: 'v1.7.1',
    date: '2026-08-07 00:30 ICT',
    changes: [
      'เพิ่มเวลา (ไม่ใช่แค่วันที่) ในทุกรายการ Changelog ให้ละเอียดขึ้น',
      'ตรวจสอบและยืนยัน Logic คำแนะนำหุ้น (BUY/HOLD/SELL_PARTIAL/SELL_ALL) ทำงานถูกต้องครบถ้วน',
      'ปรับ Decision Framework ให้ระบุชัดเจนว่าเกณฑ์ RSI อ้างอิงจาก RSI(14) รายวันเป็นตัวกระตุ้นสัญญาณหลัก ส่วน RSI(14) รายสัปดาห์ใช้ยืนยันภาพใหญ่เท่านั้น (กันความกำกวมหลังเพิ่ม Weekly RSI เข้ามา)',
    ],
  },
  {
    version: 'v1.7.0',
    date: '2026-08-04 09:15 ICT',
    changes: [
      'ปรับ Dashboard ให้ responsive บนมือถือดีขึ้น — auto-detect ขนาดจอ (< 768px) สลับเป็น Card Layout ให้อัตโนมัติ (ยังกดสลับเองด้วยปุ่ม 💻/📱 ได้เหมือนเดิม)',
      'ปรับ HoldingModal ให้ใช้งานสะดวกบนจอมือถือ (เพิ่ม padding กันชิดขอบจอ + scroll ได้เมื่อเนื้อหายาวเกินจอ)',
      'เพิ่มระบบ Version Badge + Changelog Modal (หน้าต่างนี้)',
    ],
  },
  {
    version: 'v1.6.0',
    date: '2026-08-03 14:20 ICT',
    changes: [
      'แก้ Sector/Business ให้นิ่ง 100% — ตัด AI ออกจากหน้าที่นี้ ใช้ static mapping ภาษาไทย + Yahoo Finance เป็น fallback แทน (เดิมสลับข้อความไปมาทุกครั้งที่วิเคราะห์ใหม่)',
      'เพิ่มปุ่ม "ส่งโน้ตสั่งงาน AI" ใน Quick Notes Drawer — copy โน้ตพร้อม prompt template + preservation rules ลง clipboard ในคลิกเดียว',
    ],
  },
  {
    version: 'v1.5.0',
    date: '2026-08-02 20:05 ICT',
    changes: [
      'เพิ่มฟีเจอร์ Quick Notes / Scratchpad Drawer — จดไอเดีย/ฟีเจอร์ที่อยากทำเพิ่ม บันทึกอัตโนมัติ (floating button + slide-over บนคอม / bottom sheet บนมือถือ)',
    ],
  },
  {
    version: 'v1.4.0',
    date: '2026-08-01 11:40 ICT',
    changes: [
      'เพิ่ม Weekly RSI(14) คู่กับ Daily RSI ให้ AI เห็นภาพ momentum ทั้งระยะสั้นและระยะยาว',
      'เพิ่ม Market Status Badge — สถานะเปิด/ปิดตลาด US พร้อม countdown แบบ real-time รองรับปฏิทินวันหยุด NYSE (2026-2028) และวันปิดเร็ว',
    ],
  },
  {
    version: 'v1.3.0',
    date: '2026-07-31 22:50 ICT',
    changes: [
      'เพิ่มระบบ Daily Cron Analysis — วิเคราะห์หุ้นทั้งพอร์ตอัตโนมัติทุกวัน 06:00 น. เวลาไทย ผ่าน Vercel Cron',
      'เพิ่มระบบ Track Record — วัด win rate ของสัญญาณ AI ย้อนหลัง 7/30 วัน เทียบกับราคาจริงที่เกิดขึ้น',
      'เพิ่ม fallback ใช้ผลวิเคราะห์ล่าสุดที่สำเร็จ ถ้าวันนี้ยังไม่มี (กันหน้าจอว่างเปล่าตอนเข้าเว็บก่อน cron รัน)',
    ],
  },
  {
    version: 'v1.2.0',
    date: '2026-07-30 18:10 ICT',
    changes: [
      'เพิ่ม Earnings Calendar check — เตือนความเสี่ยงก่อนประกาศผลประกอบการภายใน 7 วัน',
      'เพิ่มการคำนวณ Support/Resistance (20-day swing high/low) และ Volume Ratio จริงจากข้อมูลราคา กัน AI เดาตัวเลขเอง',
      'เพิ่ม Model Transparency Badge — โชว์ว่า Groq โมเดลไหน (70b หลัก/8b สำรอง) เป็นคนตอบ',
    ],
  },
  {
    version: 'v1.1.0',
    date: '2026-07-28 16:30 ICT',
    changes: [
      'อัปเกรดการวิเคราะห์ AI เป็นแบบสถาบันการเงิน — เพิ่ม Technical Indicators เต็มรูปแบบ (EMA/RSI/MACD/Bollinger Bands) จากข้อมูล OHLCV จริง',
      'เพิ่มระบบ fallback โมเดล Groq (llama-3.3-70b -> llama-3.1-8b-instant) อัตโนมัติเมื่อโดน rate limit',
      'ปรับปรุงความปลอดภัยระบบทั้งหมด (RLS, จำกัดการใช้ Service Role, บังคับเช็ค auth ทุก API route)',
    ],
  },
  {
    version: 'v1.0.0',
    date: '2026-07-20 12:00 ICT',
    changes: [
      'เปิดตัวระบบติดตามพอร์ตหุ้น US ส่วนตัว "พอร์ตน้องเจน" พร้อมเข้ารหัสต้นทุน (cost basis) ด้วย pgcrypto',
      'ระบบวิเคราะห์สัญญาณ AI เบื้องต้น (BUY/HOLD/SELL) และติดตามราคา/กำไรขาดทุนแบบ real-time',
    ],
  },
]

// เวอร์ชันล่าสุด — ดึงจากรายการบนสุดของ changelog ให้อัตโนมัติ ใช้โชว์ Version Badge
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
