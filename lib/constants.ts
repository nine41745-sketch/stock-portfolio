// ค่าคงที่ของระบบ รวมไว้ที่เดียวกันแทนการฝัง magic number กระจายในโค้ด

// เวลา auto-lock พอร์ตเมื่อไม่มีการใช้งาน — คง Supabase/Gmail session ไว้ แล้วให้ใส่ PIN ใหม่เท่านั้น
export const AUTO_PIN_LOCK_MS = 30 * 60 * 1000      // 30 นาที
export const AUTO_PIN_LOCK_WARN_MS = 29 * 60 * 1000 // เตือนก่อน 1 นาที

// Safety fallback ของ legacy timer ใน PortfolioDashboard เดิม
// ตั้งไว้ 24 ชม. เพื่อไม่ให้แข่งกับ AUTO_PIN_LOCK 30 นาที; เมื่อ AUTO_PIN_LOCK ทำงานจะ route ไป /pin
// ทำให้ PortfolioDashboard unmount และ timer fallback นี้ถูก clear ก่อนถึงเวลาอยู่แล้ว
export const AUTO_LOGOUT_MS = 24 * 60 * 60 * 1000
export const AUTO_LOGOUT_WARN_MS = AUTO_LOGOUT_MS - 60 * 1000

// อัตราแลกเปลี่ยน USD/THB สำรอง เมื่อดึงจาก open.er-api.com ไม่ได้
export const FALLBACK_USD_THB_RATE = 33.5

// cache TTL (วินาที)
export const ANALYZE_CACHE_TTL_SEC = 1800 // 30 นาที
export const NEWS_CACHE_TTL_SEC = 3600    // 1 ชั่วโมง
