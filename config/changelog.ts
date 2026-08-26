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
    version: 'v1.13.0',
    date: '2026-08-26 16:45 ICT',
    changes: [
      'เปลี่ยน Daily Auto Analysis เวลา ~08:15 จากการเรียก Groq แยกทีละหุ้นเป็น Portfolio Batch 1 ครั้งต่อ user — แก้ปัญหา production ที่วันนี้ 8 หุ้นมีเพียง META/NOW สำเร็จ ส่วน NVO/ORCL/PLTR/RBRK/SOFI/SPCX ถูก RATE_LIMIT เพราะ TPM ถูกใช้ต่อเนื่องจากหลาย request',
      'Batch AI เห็นหุ้นที่ต้องวิเคราะห์พร้อมบริบทพอร์ตทั้งก้อนใน request เดียว (ราคา/ต้นทุน/P&L/position weight/เงินสด/technical/earnings/ข่าว) ทำให้คำแนะนำรายวันเปรียบเทียบกันในบริบทพอร์ตเดียวกัน และลด Groq calls จาก N ครั้งต่อหุ้นเหลือ 1 ครั้งต่อ user',
      'คง deterministic SELL_ALL safeguard แบบเดียวกับระบบ manual: SELL_ALL ต้อง thesisBroken=true และมี sellAllEvidenceTypes จาก allowlist thesis-breaking เฉพาะบริษัทเท่านั้น; technical/P&L/macro เพียงอย่างเดียวไม่สามารถผ่าน safeguard ได้ และ action ที่ไม่ผ่านจะ downgrade เป็น SELL_PARTIAL/HOLD โดยไม่มีทางอัปเกรดเป็น BUY',
      'ตัด Groq call แยกสำหรับแปล/จำแนกข่าวใน cron โดยรวมการแปลและ news impact เข้า batch call เดียว ลดโอกาสกิน TPM ก่อนเริ่มวิเคราะห์หุ้น พร้อมคง Finnhub news relevance filter เดิม',
      'Cron บันทึก daily_analyses เฉพาะผลที่ AI วิเคราะห์สำเร็จจริงอีกต่อไป ไม่สร้าง HOLD ปลอมเมื่อ batch fail/rate-limit; dedup ยังนับเฉพาะแถว error IS NULL และสามารถเขียนทับ error row เก่าด้วยผลสำเร็จเมื่อ rerun วันเดียวกัน',
      'แก้ portfolio valuation ของ cron: ถ้าราคาหุ้นตัวใดหาไม่ได้ จะส่ง totalPortfolioValue เป็น N/A แทนการรวมเฉพาะหุ้นที่มีราคา ซึ่งป้องกัน position weight/cash ratio ผิดจาก partial portfolio total',
      'Manual ปุ่ม "วิเคราะห์ AI", PIN/Auth, Supabase schema, cron schedule 01:15 UTC (~08:15 ICT) และ Vercel maxDuration 60s ไม่ถูกเปลี่ยนใน release นี้',
    ],
  },
  {
    version: 'v1.12.2',
    date: '2026-08-19 15:22 ICT',
    changes: [
      'แก้บั๊ก production: Groq คืน HTTP 429 (rate limit) บนโมเดลหลัก openai/gpt-oss-120b เป็นครั้งคราว (log จริง: TPM Limit 8000, Used 1933, Requested 6761, retry-after ~5.2s) — เดิม fallback ไป GPT-OSS 20B ทันทีทุกครั้งที่โดน rate limit แม้จะเป็นแค่ rate limit ชั่วคราวที่รอไม่กี่วินาทีก็หายก็ตาม ทำให้คุณภาพคำตอบลดลงโดยไม่จำเป็น',
      'เพิ่ม bounded retry (สูงสุด 1 ครั้ง) สำหรับปุ่ม "วิเคราะห์ AI" แบบ manual (interactive): ถ้าโดน 429 และ retry-after (จาก HTTP header) สั้นกว่าหรือเท่ากับ 8 วินาที จะรอแล้วลอง 120B อีกครั้งก่อน fallback ไป 20B ถ้า retry-after ยาวกว่านั้นหรือ retry แล้วยัง 429 จึง fallback ไป 20B ทันทีตามระบบเดิม — ไม่มี retry loop ไม่ retry 400/401/403/413 ด้วยวิธีเดียวกัน',
      'Cron รายวัน (interactive=false) ไม่รอ retry-after เลยในทุกกรณี fallback ไป 20B ทันทีเมื่อโดน 429 เพื่อรักษา runtime budget ของ Vercel function ที่ต้องวิเคราะห์หลายหุ้นต่อเนื่องกัน (ยืนยันแล้วว่า cron วิเคราะห์แบบ sequential อยู่แล้ว ไม่ได้ยิง Groq พร้อมกันหลาย request)',
      'Cron แยกรายงานผล processed / skipped (dedup) / failed / rateLimited ให้ชัดเจนแทนการรวมเป็น "processed" เดียว — ไม่กระทบข้อมูลที่บันทึกลง daily_analyses (ยังคง error field ตามเดิม ไม่มีการนับผลที่ล้มเหลว/โดน rate limit เป็นผลวิเคราะห์สำเร็จ) หุ้นตัวใดตัวหนึ่ง fail ไม่ทำให้หุ้นอื่นหรือ user อื่นในรอบเดียวกันหยุดวิเคราะห์',
      'จัดโครงสร้างพรอมต์ของ analyzeHoldingDetailed ใหม่ให้ส่วน STATIC (Decision Framework, กติกา SELL_ALL, JSON schema, คำสั่งทั่วไป) อยู่ต้นพรอมต์เสมอ และย้ายส่วน DYNAMIC (symbol, ราคา/เทคนิคัล, portfolio context, ข่าว) ไปไว้ท้ายพรอมต์แทน — เพิ่มโอกาสให้ Groq automatic prompt caching จับ prefix ที่ตรงกันได้ (เดิม symbol ที่เปลี่ยนทุกครั้งอยู่ประโยคแรกสุด ทำให้ prefix ไม่ตรงกันเลย) ไม่เปลี่ยน semantics/เนื้อหาใดๆ เป็นการย้ายตำแหน่งเท่านั้น ไม่เพิ่ม cache service ใหม่ (ยังใช้ automatic caching ของ Groq เอง)',
      'ไม่แตะ max_completion_tokens (2200), cron schedule (01:15 UTC), maxDuration, model IDs 120B/20B, Portfolio-Aware context, sellAllEvidenceTypes allowlist, deterministic SELL_ALL safeguard, PIN/Auth หรือ portfolio accounting ใดๆ ในรอบนี้',
    ],
  },
  {
    version: 'v1.12.1',
    date: '2026-08-19 03:40 ICT',
    changes: [
      'แก้บั๊ก production: Groq คืน HTTP 413 "Request too large... tokens per minute (TPM): Limit 8000, Requested 8051" บนโมเดลหลัก openai/gpt-oss-120b — เกิดจาก request ของ analyzeHoldingDetailed (ใช้ทั้งปุ่ม "วิเคราะห์ AI" แบบ manual และ cron รายวัน) มีขนาดเกินลิมิต TPM หลังขยาย Portfolio-Aware Decision Framework ใน v1.12.0',
      'ลด output token budget (max_completion_tokens) จาก 2600 กลับมาที่ 2200 — ค่านี้นับรวมเป็นส่วนหนึ่งของ "Requested" tokens ที่ Groq ใช้เช็ค TPM เสมอ ไม่ใช่แค่ prompt tokens',
      'ทำให้เนื้อหาพรอมต์ของ Decision Framework กระชับขึ้น (ตัดตัวอย่างประกอบ/ถ้อยคำซ้ำซ้อนที่ไม่จำเป็นต่อการตัดสินใจออก) โดยยังคงกฎ/threshold/หมวดหลักฐาน SELL_ALL, safeguard, และเนื้อหาบริบทพอร์ต (ทุน/มูลค่า/P&L/สัดส่วน/หุ้นอื่น/เทคนิคัล/ข่าว/valuation) ไว้ครบทุกประการ',
      'ย่อรูปแบบสรุปหุ้นอื่นในพอร์ตให้กระชับขึ้น (SYMBOL:weight% แทน SYMBOL (weight%)) และปรับจำนวนข่าวที่ส่งให้ AI จาก 5 เหลือ 4 ชิ้น พร้อมเพิ่มการจำกัดความยาวหัวข้อข่าวต่อชิ้น (cap + ตัดจบด้วย "…") กันหัวข้อข่าวยาวผิดปกติทำให้ request บวมโดยไม่จำเป็น ไม่กระทบการจำแนก/ความเกี่ยวข้องของข่าวเดิม',
      'ไม่แตะ Groq model/temperature/reasoning_effort/reasoning_format, cron schedule (01:15 UTC), PIN/Auth, หรือ portfolio accounting ใดๆ ในรอบนี้',
    ],
  },
  {
    version: 'v1.12.0',
    date: '2026-08-19 03:08 ICT',
    changes: [
      'ปรับ AI Decision Framework ให้ "portfolio-aware" ทั้งระบบ — พิจารณาบริบทพอร์ตทั้งก้อน (มูลค่าพอร์ตรวม, สัดส่วนหุ้นนี้ในพอร์ต, หุ้นอื่นที่ถืออยู่และสัดส่วน) ประกอบการแนะนำ BUY/HOLD/SELL_PARTIAL/SELL_ALL ไม่ใช่วิเคราะห์หุ้นแต่ละตัวแบบโดดๆ อีกต่อไป ใช้ได้กับหุ้นทุกตัวในพอร์ตปัจจุบันและ ticker ใหม่ในอนาคตโดยอัตโนมัติ ไม่มี logic เฉพาะเจาะจงหุ้นตัวใดตัวหนึ่ง',
      'ยกเครื่องเกณฑ์ SELL_ALL ให้เป็น threshold สูง — ห้ามใช้ price<EMA200/EMA ขาลง/MACD ลบ/RSI อ่อนแอ/downtrend/ข่าวภาพรวมตลาด/unrealized loss เพียงลำพังเป็นตัวตัดสิน SELL_ALL อีกต่อไป ต้องมีหลักฐาน thesis-breaking จริง (fundamentals เสียหายมีสาระสำคัญ, fraud/governance, solvency risk, สูญเสียความสามารถแข่งขันเชิงโครงสร้าง, ปัญหากฎหมาย/กำกับดูแลรุนแรง) เทคนิคัลอ่อนแอเพียงอย่างเดียวตอนนี้มีผลต่อ timing/ขนาดโพซิชันแทน (HOLD/DCA/SELL_PARTIAL) ไม่ใช่บังคับขายทั้งหมด',
      'เพิ่ม deterministic server-side safeguard คู่กับเกณฑ์ SELL_ALL ข้างต้น — AI ต้องส่ง structured evidence ("thesisBroken" + "sellAllEvidence") มาคู่กับ action ทุกครั้ง ถ้า action เป็น SELL_ALL แต่หลักฐานไม่ผ่านการตรวจสอบฝั่ง server (ไม่ใช่แค่พึ่ง prompt) ระบบจะไม่แสดง SELL_ALL ให้ผู้ใช้เห็น และลด action ลงเองอัตโนมัติเป็น SELL_PARTIAL หรือ HOLD ตามความเหมาะสม (ไม่มีทางถูกอัปเกรดเป็น BUY จากการ downgrade นี้) พร้อมแจ้งเหตุผลการปรับให้ผู้ใช้เห็นในข้อควรระวัง',
      'เพิ่มแนวทางแยกข่าวเฉพาะบริษัทออกจากข่าวภาพรวมตลาด/sector/ETF — ข่าวภาพรวมตลาดห้ามถูกตีความเป็นเหตุการณ์ลบร้ายแรงเฉพาะบริษัทอีกต่อไป',
      'เพิ่มแนวทาง BUY แบบคำนึงถึง concentration risk (เตือนเมื่อสัดส่วนหุ้นตัวเดียวสูงเกินไป) และข้อจำกัดเรื่องเงินสด แทนการแนะนำซื้อตามสัญญาณเทคนิคัลอย่างเดียว',
      'เพิ่มแนวทาง valuation confidence — ระบุชัดว่า P/E ที่มีเป็น trailing/normalized เท่านั้น ไม่มี forward P/E และไม่มี timestamp ความสดของข้อมูล ห้ามสรุปแพง/ถูกจาก P/E ตัวเดียวถ้าข้อมูลไม่พอ',
      'ขยาย field "summary" ให้ครอบคลุมมุมมองพื้นฐาน/valuation/ผลกระทบต่อพอร์ต/เหตุผลที่ action นี้เหมาะกับพอร์ตผู้ใช้ และต้องระบุตรงๆ ถ้าเทคนิคัลกับพื้นฐาน/valuation ขัดแย้งกัน ย้าย field นี้มาไว้ต้น schema (แทนท้ายสุด) พร้อมเพิ่ม token budget เพื่อลดความเสี่ยงถูกตัดทิ้งกลางคัน',
      'ถ้าข้อมูลบริบทพอร์ต (มูลค่าพอร์ตรวม/สัดส่วน) คำนวณไม่ได้ (เช่น ราคาหุ้นบางตัวหาไม่ได้) AI ต้องระบุว่า portfolio context ไม่ครบ ห้ามเดาตัวเลขเอง',
      'ปรับ Daily Auto-Analysis (cron) ให้เป็นเวลาไทยประมาณ 08:15 (01:15 UTC) จากเดิม ~06:00 และใช้ Portfolio-Aware Decision Framework ตัวเดียวกับปุ่ม "วิเคราะห์ AI" แบบ manual ทุกประการ (รวม safeguard ด้านบน) วิเคราะห์หุ้นที่ถืออยู่ทั้งหมดของทุก user อัตโนมัติ เก็บผลลงตาราง daily_analyses เดิม เป็นแหล่งข้อมูลเดียวกับที่ dashboard อ่านอยู่แล้ว ไม่มีตาราง/แหล่งข้อมูลใหม่ซ้ำซ้อน',
      'เพิ่มการข้ามหุ้นที่มีผลวิเคราะห์สำเร็จของวันนั้นอยู่แล้วใน cron (กันเรียก Groq ซ้ำซ้อนถ้า endpoint ถูกยิงมากกว่า 1 ครั้ง/วัน) โดยอาศัยตาราง daily_analyses เดิมเป็นตัวตรวจสอบ ไม่ได้เพิ่มระบบ cache/calendar วันหยุดใหม่ใดๆ',
    ],
  },
  {
    version: 'v1.11.0',
    date: '2026-08-18 16:15 ICT',
    changes: [
      'เพิ่มปุ่มรูปตา Show/Hide PIN ให้ทุกช่องกรอก PIN ในระบบ (Set PIN, Confirm PIN, Verify PIN, Change PIN: PIN ปัจจุบัน/PIN ใหม่/ยืนยัน PIN ใหม่) — default ซ่อนเป็น ****** เสมอ กดปุ่มรูปตาเพื่อสลับแสดง/ซ่อนได้ต่ออิสระในแต่ละช่อง',
      'visibility เป็น local UI state ล้วนๆ ไม่ persist ลง localStorage/sessionStorage/cookie ใดๆ — เปิดหน้า/component ใหม่กลับมาซ่อนเสมอ ไม่กระทบ PIN hashing/session/lockout/security architecture เลย',
    ],
  },
  {
    version: 'v1.10.1',
    date: '2026-08-18 15:21 ICT',
    changes: [
      'แก้บั๊ก production ที่หน้า Set PIN/Confirm PIN/Verify PIN/Change PIN: browser ขึ้น "โปรดจับคู่รูปแบบที่ร้องขอ" แม้กรอกเลข ASCII 0-9 ครบ 6 หลักถูกต้องแล้ว — เปลี่ยน HTML pattern attribute จาก \\d* เป็น [0-9]{6} ให้ browser-compatible มากขึ้นในทุกจุดที่กรอก PIN',
      'ไม่กระทบ inputMode="numeric"/maxLength={6}/server-side validation (isValidPinFormat) เดิมแต่อย่างใด',
    ],
  },
  {
    version: 'v1.10.0',
    date: '2026-08-18 14:45 ICT',
    changes: [
      'เพิ่มระบบ Portfolio PIN Lock — ล็อกพอร์ตด้วย PIN 6 หลักหลัง login Gmail/Supabase สำเร็จ (ชั้นป้องกันที่ 2 แยกจาก Auth) บังคับที่ server-side middleware ไม่ใช่แค่ UI',
      'PIN hash ด้วย scrypt (memory-hard) + salt สุ่มต่อ user + server pepper แยกเก็บใน environment variable ไม่เก็บ PIN จริงหรือ SHA-256 ธรรมดา',
      'PIN-unlocked session เป็น signed HttpOnly cookie ที่ server ตรวจสอบได้จริง แยกจาก Supabase Auth session โดยสิ้นเชิง — ปลอมผ่าน localStorage/DevTools ไม่ได้',
      'ผิด PIN ครบ 5 ครั้ง ล็อก 5 นาที คำนวณแบบ atomic ฝั่ง Postgres กัน race condition จากหลาย request พร้อมกัน',
      'ปุ่ม "🔒 ล็อก" (ล็อกพอร์ตอย่างเดียว ไม่ signOut Gmail) แยกชัดเจนจาก "ออกจากระบบ" (signOut เต็มรูปแบบ) + เปลี่ยน PIN ได้จากหน้า Settings',
      'ตาราง user_pin_security ใหม่ — RLS deny-by-default เข้าถึงได้เฉพาะ service_role เท่านั้น ไม่ expose ผ่าน client SELECT',
    ],
  },
  {
    version: 'v1.9.5',
    date: '2026-08-18 14:28 ICT',
    changes: [
      'แก้ label โมเดล AI บนการ์ดวิเคราะห์ที่ hardcode ชื่อ "Llama-8b/Llama-70b" เดิม ให้ตรงกับโมเดลจริงหลัง migrate เป็น GPT-OSS (🤖 GPT-OSS 120B / ⚡ GPT-OSS 20B) และ fallback ไปแสดงชื่อโมเดลดิบจาก usedModel แทนการเดาชื่อ ถ้าเปลี่ยนโมเดลอีกในอนาคต',
    ],
  },
  {
    version: 'v1.9.4',
    date: '2026-08-18 14:18 ICT',
    changes: [
      'แก้ /api/health ขึ้น "groq: ❌ unknown" หลัง migrate โมเดล — โมเดลตระกูล openai/gpt-oss-* ต้องการ parameter max_completion_tokens แทน max_tokens เดิม เปลี่ยนทั้งใน lib/groq.ts และ /api/health พร้อมเพิ่ม reasoning_effort/reasoning_format',
      'เพิ่ม diagnostic ใน /api/health ให้เห็น HTTP status/error body/finish_reason จริงแทนข้อความ "unknown" เดิม',
    ],
  },
  {
    version: 'v1.9.3',
    date: '2026-08-18 14:07 ICT',
    changes: [
      'Groq ปิด/deprecate โมเดล llama-3.3-70b-versatile และ llama-3.1-8b-instant แล้ว — migrate โมเดลหลัก/สำรองเป็น openai/gpt-oss-120b / openai/gpt-oss-20b ทั้งใน lib/groq.ts และ /api/health',
    ],
  },
  {
    version: 'v1.9.2',
    date: '2026-08-18 13:35 ICT',
    changes: [
      'แก้บั๊ก production หลัง Batch 2: กรณี Groq ตอบว่างเปล่า/ไม่มี action ที่ชัดเจน/ไม่มี technicalSummary เคยถูกนับเป็น "วิเคราะห์สำเร็จ" ปลอม (การ์ดเทคนิคัล RSI/EMA/MACD/BB/แนวรับ-แนวต้าน/Volume หายทั้งก้อนโดยไม่มี error แจ้ง) — เปลี่ยนให้ return error แทนในทุกกรณี พร้อมรักษากลไก regex recovery action จาก JSON ที่ถูกตัดท้ายไว้เหมือนเดิม',
      'แก้ข่าวหุ้นอื่นที่ไม่เกี่ยวข้อง (เช่น Broadcom/Apple) หลุดปนเข้ามาในการวิเคราะห์ META — เพิ่ม positive-match relevance filter ต่อ symbol เป้าหมาย',
    ],
  },
  {
    version: 'v1.9.1',
    date: '2026-08-18 11:37 ICT',
    changes: [
      '/api/analyze เลิกเชื่อ market data จาก client ทั้งหมด (current_price/pe/week52High/week52Low/dayChange/recentNews/totalPortfolioValue) — client ส่งได้แค่ symbol เท่านั้น ทุกอย่างอื่นดึง/คำนวณฝั่ง server (Finnhub/Yahoo/Stooq) ทั้งหมด กัน DevTools ปลอมข้อมูลป้อนเข้า AI',
    ],
  },
  {
    version: 'v1.9.0',
    date: '2026-08-08 01:09 ICT',
    changes: [
      'ปรับ Decision Framework เกณฑ์ SELL_PARTIAL ข้อ (ค): เดิมเขียนกำกวมว่า "ราคาชนแนวต้านสำคัญ" ทำให้ AI ตีความราคาทะลุแนวต้านเป็นสัญญาณ bullish breakout แล้วเลือก HOLD ทั้งที่ควรล็อกกำไรบางส่วน (เคสจริง: NOW ราคา $124.89 ทะลุแนวต้าน $120 ไปแล้ว กำไร +19.57% แต่ AI ยังแนะนำ HOLD)',
      'เปลี่ยนเป็นเงื่อนไขตัวเลขชัดเจน: ราคาปัจจุบัน > แนวต้าน/52W High/BB Upper และ P&L เป็นบวกเกิน +15% ให้เข้าเกณฑ์ SELL_PARTIAL ทันที พร้อมเพิ่มตัวอย่างเคส NOW จริงกำกับในพรอม กันตีความผิดซ้ำ',
      'ปรับปรุงร่วมกับความเห็นจาก ChatGPT + Gemini (ขอ 2nd opinion เรื่อง wording ของเงื่อนไข)',
    ],
  },
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
