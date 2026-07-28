// ค่าคงที่ของระบบ รวมไว้ที่เดียวกันแทนการฝัง magic number กระจายในโค้ด

// เวลา auto-logout เมื่อไม่มีการใช้งาน
export const AUTO_LOGOUT_MS = 30 * 60 * 1000      // 30 นาที
export const AUTO_LOGOUT_WARN_MS = 29 * 60 * 1000 // เตือนก่อน 1 นาที

// อัตราแลกเปลี่ยน USD/THB สำรอง เมื่อดึงจาก open.er-api.com ไม่ได้
export const FALLBACK_USD_THB_RATE = 33.5

// cache TTL (วินาที)
export const ANALYZE_CACHE_TTL_SEC = 1800 // 30 นาที
export const NEWS_CACHE_TTL_SEC = 3600    // 1 ชั่วโมง
