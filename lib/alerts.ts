export type AlertKind = 'STOP' | 'TARGET' | 'NEAR_SUPPORT' | 'BREAKOUT' | 'EARNINGS'
export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO'

export interface AlertInput {
  symbol: string
  price: number | null
  support: number | null
  resistance: number | null
  volumeRatio: number | null
  stopLoss: number | null
  target1: number | null
  target2: number | null
  earnings: { date: string; daysUntil: number; hour: string | null } | null
}

export interface AlertItem {
  id: string
  symbol: string
  kind: AlertKind
  severity: AlertSeverity
  title: string
  detail: string
  price: number | null
  level: number | null
  distancePct: number | null
  eventDate: string | null
}

const round2 = (value: number): number => Math.round(value * 100) / 100

function pctFromLevel(price: number, level: number): number {
  return round2(((price - level) / level) * 100)
}

function push(
  items: AlertItem[],
  input: AlertInput,
  kind: AlertKind,
  severity: AlertSeverity,
  title: string,
  detail: string,
  level: number | null = null,
  distancePct: number | null = null,
  eventDate: string | null = null,
) {
  items.push({
    id: `${input.symbol}:${kind}:${level ?? eventDate ?? 'live'}`,
    symbol: input.symbol,
    kind,
    severity,
    title,
    detail,
    price: input.price,
    level,
    distancePct,
    eventDate,
  })
}

export function buildAlerts(inputs: AlertInput[], nearPct = 2): AlertItem[] {
  const items: AlertItem[] = []

  for (const raw of inputs) {
    const input: AlertInput = { ...raw, symbol: raw.symbol.trim().toUpperCase() }
    const price = input.price

    if (price !== null && Number.isFinite(price) && price > 0) {
      if (input.stopLoss !== null && input.stopLoss > 0) {
        const distance = pctFromLevel(price, input.stopLoss)
        if (price <= input.stopLoss) {
          push(
            items,
            input,
            'STOP',
            'CRITICAL',
            'ถึง/หลุด Stop',
            `ราคาปัจจุบัน $${price.toFixed(2)} อยู่ที่หรือต่ำกว่า Stop $${input.stopLoss.toFixed(2)}`,
            input.stopLoss,
            distance,
          )
        } else if (distance <= nearPct) {
          push(
            items,
            input,
            'STOP',
            'WARNING',
            'ใกล้ Stop',
            `ราคาอยู่เหนือ Stop ${distance.toFixed(2)}%`,
            input.stopLoss,
            distance,
          )
        }
      }

      const reachedTarget = input.target2 !== null && input.target2 > 0 && price >= input.target2
        ? { label: 'Target 2', level: input.target2 }
        : input.target1 !== null && input.target1 > 0 && price >= input.target1
          ? { label: 'Target 1', level: input.target1 }
          : null

      if (reachedTarget) {
        push(
          items,
          input,
          'TARGET',
          'INFO',
          `ถึง ${reachedTarget.label}`,
          `ราคาปัจจุบัน $${price.toFixed(2)} ถึงระดับ ${reachedTarget.label} $${reachedTarget.level.toFixed(2)}`,
          reachedTarget.level,
          pctFromLevel(price, reachedTarget.level),
        )
      }

      if (input.support !== null && input.support > 0) {
        const distance = pctFromLevel(price, input.support)
        if (price < input.support) {
          push(
            items,
            input,
            'NEAR_SUPPORT',
            'CRITICAL',
            'หลุดแนวรับ',
            `ราคาปัจจุบันต่ำกว่าแนวรับอ้างอิง $${input.support.toFixed(2)}`,
            input.support,
            distance,
          )
        } else if (distance <= nearPct) {
          push(
            items,
            input,
            'NEAR_SUPPORT',
            'WARNING',
            'ใกล้แนวรับ',
            `ราคาอยู่เหนือแนวรับอ้างอิง ${distance.toFixed(2)}%`,
            input.support,
            distance,
          )
        }
      }

      if (input.resistance !== null && input.resistance > 0 && price > input.resistance) {
        const distance = pctFromLevel(price, input.resistance)
        const volumeText = input.volumeRatio !== null
          ? ` · Volume Ratio ${input.volumeRatio.toFixed(2)}x`
          : ''
        push(
          items,
          input,
          'BREAKOUT',
          'INFO',
          input.volumeRatio !== null && input.volumeRatio >= 1.2 ? 'Breakout + Volume' : 'Breakout',
          `ราคาสูงกว่าแนวต้านอ้างอิง ${distance.toFixed(2)}%${volumeText}`,
          input.resistance,
          distance,
        )
      }
    }

    if (input.earnings && input.earnings.daysUntil >= 0 && input.earnings.daysUntil <= 7) {
      const dayText = input.earnings.daysUntil === 0
        ? 'วันนี้'
        : `อีก ${input.earnings.daysUntil} วัน`
      const hourText = input.earnings.hour ? ` (${input.earnings.hour.toUpperCase()})` : ''
      push(
        items,
        input,
        'EARNINGS',
        input.earnings.daysUntil <= 2 ? 'WARNING' : 'INFO',
        'Earnings ใกล้เข้ามา',
        `กำหนดประกาศงบ ${dayText}${hourText}`,
        null,
        null,
        input.earnings.date,
      )
    }
  }

  const severityOrder: Record<AlertSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }
  return items.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity]
    || a.symbol.localeCompare(b.symbol)
    || a.kind.localeCompare(b.kind)
  )
}

export function summarizeAlerts(items: AlertItem[]) {
  return {
    total: items.length,
    critical: items.filter(item => item.severity === 'CRITICAL').length,
    warning: items.filter(item => item.severity === 'WARNING').length,
    info: items.filter(item => item.severity === 'INFO').length,
  }
}
