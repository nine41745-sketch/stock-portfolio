import type { AlertKind } from './alerts'

export function evaluationTime(value: string | null | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) return 'ไม่ทราบเวลาประเมิน'
  return new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' ICT'
}
export function levelLabel(kind: AlertKind): string {
  if (kind === 'NEAR_SUPPORT' || kind === 'IMPORTANT_SUPPORT') return 'แนวรับ'
  if (kind === 'BREAKOUT') return 'แนวต้าน'
  if (kind === 'STOP') return 'ระดับ Stop'
  if (kind === 'TARGET') return 'ระดับ Target'
  if (kind === 'ATH') return 'จุดสูงสุดอ้างอิง'
  return 'ระดับอ้างอิง'
}
