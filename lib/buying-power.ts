// v1.41.47: งบซื้อสำหรับการวิเคราะห์หุ้น = เงินสด DIME + เงินในธนาคาร (user_settings.dime_balance + cash_balance)
// ใช้ร่วมกันทั้ง cron daily, cron premarket และปุ่มวิเคราะห์ AI เพื่อให้ผลทุกจุดใช้กติกาเดียวกัน

function toNonNegativeAmount(value: unknown): number {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

export function resolveBuyingPower(dimeBalance: unknown, bankBalance: unknown): number {
  return toNonNegativeAmount(dimeBalance) + toNonNegativeAmount(bankBalance)
}
