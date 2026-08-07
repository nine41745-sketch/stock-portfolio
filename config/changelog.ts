// ============================================================
// Changelog — ประวัติการอัปเดตระบบ "พอร์ตน้องเจน"
// เพิ่มเวอร์ชันใหม่โดยแทรกรายการใหม่ไว้ "บนสุด" ของ array นี้ (เรียงใหม่สุด -> เก่าสุด)
// CURRENT_VERSION ด้านล่างจะดึงจากรายการแรกให้อัตโนมัติ ไม่ต้องแก้ 2 ที่
// หมายเหตุ: วันที่/เวลาทุกรายการอ้างอิงจาก git commit history จริง (ไม่ใช่การประมาณ)
// ============================================================

export interface ChangelogEntry {
  version: string
  date: string   // YYYY-MM-DD HH:MM ICT
  changes: string[]
}

export const changelog: ChangelogEntry[] = [
  {
    version: 'v1.8.2',
    date: '2026-08-08 00:54 ICT',
    changes: [
      'แก้บั๊กที่ Audit เจอไว้ (ChatGPT): เพิ่มหุ้นใหม่แล้วกดแก้/ลบทันทีโดยยังไม่รีเฟรชหน้าจะ error "invalid input syntax for type uuid" — สาเหตุคือ frontend สร้าง ID ปลอมจาก timestamp แทน UUID จริง ตอนนี้ใช้ UUID จริงจาก response ของ server แทน',
      'แก้บั๊กที่ Audit เจอไว้ (Gemini): แก้ไขจำนวนหุ้น (shares) แล้วมูลค่าพอร์ต/กำไรขาดทุนบนหน้าจอยังคำนวณจากค่าเก่าจนกว่าจะรีเฟรช ตอนนี้คำนวณ market value ใหม่ทันทีจากราคาปัจจุบัน x จำนวนหุ้นใหม่',
    ],
  },
  {
    version: 'v1.8.1',
    date: '2026-08-08 00:45 ICT',
    changes: [
      'Hotfix ด่วน: หลังแก้ security v1.8.0 หุ้นในพอร์ตหายไปหมด (ไม่ใช่ข้อมูลหาย แค่โหลดไม่ขึ้น) — สาเหตุคือ search_path ที่จำกัดไว้ตอน v1.8.0 แคบเกินไป หาไฟล์ pgp_sym_encrypt/decrypt (pgcrypto) ของ Supabase ไม่เจอเพราะอยู่ schema extensions ไม่ใช่ public',
      'แก้โดยเพิ่ม extensions เข้า search_path ของ RPC upsert_holding/get_decrypted_holdings',
    ],
  },
  {
    version: 'v1.8.0',
    date: '2026-08-07 01:26 ICT',
    changes: [
      'Security Fix (Critical): ปิดช่องโหว่ RPC upsert_holding/get_decrypted_holdings ที่ไม่เคยจำกัดสิทธิ์ execute มาก่อน (เดิม user login แล้วเรียก RPC ตรงจาก client ปลอม user_id เป็นคนอื่นได้) จำกัดสิทธิ์เหลือเฉพาะ service_role เท่านั้น',
      'แก้บั๊ก RPC upsert_holding ถูกประกาศซ้ำ 2 รอบใน schema.sql (ตัวหลังทับตัวแรกเงียบๆ) เหลือเวอร์ชันเดียว พร้อมเพิ่ม p_notes ให้บันทึก shares/cost_basis/notes ในคำสั่งเดียว (เดิมเผื่อรอบสองพลาด notes จะหายไปเงียบๆ)',
      'Security Fix (High): app/api/analyze ไม่เชื่อ cost_basis/shares/market_value/pnl_pct/cashBalance จาก client อีกต่อไป ดึงจาก DB ฝั่ง server เองทั้งหมด กันการปลอมข้อมูลผ่าน dev tools เข้าไปหลอก AI',
      'แก้ cache key ของผลวิเคราะห์ให้รวม shares/cost_basis/cash ด้วย กันปัญหาแก้พอร์ตแล้วยังเห็นผลวิเคราะห์เก่าค้างจาก cache',
      'เพิ่ม middleware guard ชั้นเสริมสำหรับ /api/* (ยกเว้น /api/cron/*) ป้องกัน route ใหม่ในอนาคตที่อาจลืมใส่ auth check',
      'เพิ่ม migration สร้างตาราง user_settings + RLS แบบ safety net (ของเดิมใช้งานอยู่จริงแต่ไม่มี migration file ติดตามไว้)',
    ],
  },
  {
    version: 'v1.7.2',
    date: '2026-08-07 00:35 ICT',
    changes: [
      'แก้บั๊กสำคัญ: AI แนะนำ HOLD ทั้งที่เข้าเกณฑ์ SELL_ALL/SELL_PARTIAL ชัดเจน (เช่น P&L +66% ยังขึ้นถือต่อ, P&L -23% + DOWNTREND ก็ยังขึ้นถือต่อ)',
      'ต้นเหตุ: prompt เดิมเขียนเงื่อนไขย่อยเป็น bullet list ทำให้ AI ตีความเป็น "ต้องเข้าเงื่อนไขครบทุกข้อ (AND)" ทั้งที่จริงคือ "เข้าข้อใดข้อหนึ่งก็พอ (OR)"',
      'ปรับ decision framework ใหม่เป็น checklist ระบุ (ก)(ข)(ค) ชัดเจน พร้อมตัวอย่างจริงกำกับทุกระดับ กันการตีความผิดซ้ำ (ครอบคลุมหุ้นทุกตัวในระบบ)',
    ],
  },
  {
    version: 'v1.7.1',
    date: '2026-08-07 00:10 ICT',
    changes: [
      'เพิ่มเวลา (ไม่ใช่แค่วันที่) ในทุกรายการ Changelog ให้ละเอียดขึ้น',
      'ปรับ Decision Framework ให้ระบุชัดเจนว่าเกณฑ์ RSI อ้างอิงจาก RSI(14) รายวันเป็นตัวกระตุ้นสัญญาณหลัก ส่วน RSI(14) รายสัปดาห์ใช้ยืนยันภาพใหญ่เท่านั้น (กันความกำกวมหลังเพิ่ม Weekly RSI เข้ามา)',
    ],
  },
  {
    version: 'v1.7.0',
    date: '2026-08-04 02:06 ICT',
    changes: [
      'ปรับ Dashboard ให้ responsive บนมือถือดีขึ้น — auto-detect ขนาดจอ (< 768px) สลับเป็น Card Layout ให้อัตโนมัติ (ยังกดสลับเองด้วยปุ่ม 💻/📱 ได้เหมือนเดิม)',
      'ปรับ HoldingModal ให้ใช้งานสะดวกบนจอมือถือ (เพิ่ม padding กันชิดขอบจอ + scroll ได้เมื่อเนื้อหายาวเกินจอ)',
      'เพิ่มระบบ Version Badge + Changelog Modal (หน้าต่างนี้)',
    ],
  },
  {
    version: 'v1.6.0',
    date: '2026-08-04 01:37 ICT',
    changes: [
      'แก้ Sector/Business ให้นิ่ง 100% — ตัด AI ออกจากหน้าที่นี้ ใช้ static mapping ภาษาไทย + Yahoo Finance เป็น fallback แทน (เดิมสลับข้อความไปมาทุกครั้งที่วิเคราะห์ใหม่)',
      'เพิ่มปุ่ม "ส่งโน้ตสั่งงาน AI" ใน Quick Notes Drawer — copy โน้ตพร้อม prompt template + preservation rules ลง clipboard ในคลิกเดียว',
    ],
  },
  {
    version: 'v1.5.0',
    date: '2026-07-31 16:40 ICT',
    changes: [
      'เพิ่มฟีเจอร์ Quick Notes / Scratchpad Drawer — จดไอเดีย/ฟีเจอร์ที่อยากทำเพิ่ม บันทึกอัตโนมัติ (floating button + slide-over บนคอม / bottom sheet บนมือถือ)',
      'แก้บั๊ก UI ปุ่ม Copy ถูกตัดขอบด้านล่างบนจอเดสก์ท็อป (คลาส Tailwind ชนกันระหว่าง inset-y-0 กับ bottom-auto/h-screen)',
    ],
  },
  {
    version: 'v1.4.0',
    date: '2026-07-31 11:40 ICT',
    changes: [
      'เพิ่ม Weekly RSI(14) คู่กับ Daily RSI ให้ AI เห็นภาพ momentum ทั้งระยะสั้นและระยะยาว',
      'เพิ่ม Market Status Badge — สถานะเปิด/ปิดตลาด US พร้อม countdown แบบ real-time รองรับปฏิทินวันหยุด NYSE (2026-2028) และวันปิดเร็ว',
      'เพิ่มระบบ Daily Cron Analysis — วิเคราะห์หุ้นทั้งพอร์ตอัตโนมัติทุกวัน 06:00 น. เวลาไทย ผ่าน Vercel Cron',
      'เพิ่มระบบ Track Record — วัด win rate ของสัญญาณ AI ย้อนหลัง 7/30 วัน เทียบกับราคาจริงที่เกิดขึ้น',
      'เพิ่ม fallback ใช้ผลวิเคราะห์ล่าสุดที่สำเร็จ ถ้าวันนี้ยังไม่มี (กันหน้าจอว่างเปล่าตอนเข้าเว็บก่อน cron รัน) + แก้ไม่ให้ error card ค้างจากการทดสอบ',
    ],
  },
  {
    version: 'v1.3.0',
    date: '2026-07-31 03:00 ICT',
    changes: [
      'เพิ่ม Earnings Calendar check — เตือนความเสี่ยงก่อนประกาศผลประกอบการภายใน 7 วัน',
      'เพิ่มการคำนวณ Support/Resistance (20-day swing high/low) และ Volume Ratio จริงจากข้อมูลราคา กัน AI เดาตัวเลขเอง',
      'เพิ่ม Model Transparency Badge — โชว์ว่า Groq โมเดลไหน (70b หลัก/8b สำรอง) เป็นคนตอบ',
    ],
  },
  {
    version: 'v1.2.0',
    date: '2026-07-31 02:41 ICT',
    changes: [
      'อัปเกรดการวิเคราะห์ AI เป็นแบบสถาบันการเงิน — เพิ่ม Technical Indicators เต็มรูปแบบ (EMA/RSI/MACD/Bollinger Bands) จากข้อมูล OHLCV จริง',
      'เพิ่มระบบ fallback โมเดล Groq (llama-3.3-70b -> llama-3.1-8b-instant) อัตโนมัติเมื่อโดน rate limit + แยกข้อความ error ตามจริง (TPM รอสั้น vs TPD รอยาว)',
      'ย้าย field "action" ขึ้นเป็น key แรกสุดของ JSON ที่ AI ตอบกลับ — แก้บั๊กค้าง HOLD จาก token truncation',
    ],
  },
  {
    version: 'v1.1.0',
    date: '2026-07-29 04:15 ICT',
    changes: [
      'แก้บั๊ก AI signal ค้าง HOLD เสมอ — เพิ่ม token budget ให้ตอบครบ + extract signal ด้วย regex กันตัดกลางคัน',
      'ปรับปรุงความปลอดภัยระบบทั้งหมด (RLS, จำกัดการใช้ Service Role เฉพาะ RPC ที่จำเป็น, บังคับเช็ค auth ทุก API route)',
    ],
  },
  {
    version: 'v1.0.0',
    date: '2026-07-16 16:51 ICT',
    changes: [
      'เปิดตัวระบบติดตามพอร์ตหุ้น US ส่วนตัว "พอร์ตน้องเจน" พร้อมเข้ารหัสต้นทุน (cost basis) ด้วย pgcrypto',
      'ระบบวิเคราะห์สัญญาณ AI เบื้องต้น (BUY/HOLD/SELL) และติดตามราคา/กำไรขาดทุนแบบ real-time',
    ],
  },
]

// เวอร์ชันล่าสุด — ดึงจากรายการบนสุดของ changelog ให้อัตโนมัติ ใช้โชว์ Version Badge
export const CURRENT_VERSION = changelog[0]?.version ?? 'v1.0.0'
