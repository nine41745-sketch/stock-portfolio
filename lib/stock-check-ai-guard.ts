// Deterministic guards around the Stock Check AI text. The model only explains the engine's result, so any
// sentence that contradicts numbers we already computed is dropped instead of shown to the user.

export interface AiClaimFacts {
  price: number | null
  ema50: number | null
  ema200: number | null
  week52High: number | null
  week52Low: number | null
  earningsFound: boolean
}

export interface GuardedAiFields {
  summary: string
  reasons: string[]
  risks: string[]
  action: string
}

// Relative tolerance so "at the high" or "on the EMA" is not read as a contradiction.
const TOLERANCE = 0.0005
const ABOVE = new Set(['สูงกว่า', 'เหนือ'])

function isAbove(direction: string): boolean {
  return ABOVE.has(direction)
}

function consistent(direction: string, value: number, reference: number): boolean {
  return isAbove(direction)
    ? value >= reference * (1 - TOLERANCE)
    : value <= reference * (1 + TOLERANCE)
}

function finite(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalize(text: string): string {
  return text.replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ')
}

const EMA_VS_EMA = /EMA\s*50\s*(?:อยู่)?\s*(เหนือ|สูงกว่า|ต่ำกว่า|ใต้)\s*EMA\s*200/gi
const PRICE_VS_EMA = /ราคา[^|.;]{0,24}?(เหนือ|สูงกว่า|ต่ำกว่า|ใต้)\s*(?:เส้น\s*)?EMA\s*(50|200)(?:\s*(?:และ|กับ|,)\s*(?:เส้น\s*)?EMA\s*(50|200))?/gi
const VS_52W = /(เหนือ|สูงกว่า|ต่ำกว่า|ใต้)\s*(?:ระดับ\s*)?52\s*-?\s*(?:W|Week|สัปดาห์)\s*-?\s*(High|Low|สูงสุด|ต่ำสุด)/gi
const LOWER_PART_OF_RANGE = /(?:ด้านล่าง|ส่วนล่าง|ครึ่งล่าง|โซนล่าง)(?:ของ)?(?:ช่วง|กรอบ|ระยะ)\s*52/i
const UPPER_PART_OF_RANGE = /(?:ด้านบน|ส่วนบน|ครึ่งบน|โซนบน)(?:ของ)?(?:ช่วง|กรอบ|ระยะ)\s*52/i
// "No earnings date in the next 60 days" says nothing about past results, and the window looks forward.
const EARNINGS_WRONG_WINDOW = /(?:ไม่มี|ไม่พบ)(?:ข้อมูล|นัด)?\s*(?:earnings|ประกาศผล)[^|]{0,60}?(?:ล่าสุด|ที่ผ่านมา|ย้อนหลัง)/i
const EARNINGS_DENIED = /(?:ไม่มี|ไม่พบ)(?:ข้อมูล|นัด)?\s*(?:earnings|ประกาศผล)/i

/** Returns a short rule name when the text contradicts the computed facts, otherwise null. */
export function findAiClaimViolation(rawText: string, facts: AiClaimFacts): string | null {
  let text = normalize(rawText)
  const { price, ema50, ema200, week52High, week52Low } = facts

  if (finite(ema50) && finite(ema200)) {
    for (const match of text.matchAll(EMA_VS_EMA)) {
      if (!consistent(match[1], ema50, ema200)) return 'ema50-vs-ema200'
    }
  }
  text = text.replace(EMA_VS_EMA, ' ')

  if (finite(price)) {
    for (const match of text.matchAll(PRICE_VS_EMA)) {
      for (const period of [match[2], match[3]]) {
        const ema = period === '50' ? ema50 : period === '200' ? ema200 : null
        if (finite(ema) && !consistent(match[1], price, ema)) return `price-vs-ema${period}`
      }
    }
    for (const match of text.matchAll(VS_52W)) {
      const isHigh = /^(high|สูงสุด)$/i.test(match[2])
      const reference = isHigh ? week52High : week52Low
      if (finite(reference) && !consistent(match[1], price, reference)) return isHigh ? 'price-vs-52w-high' : 'price-vs-52w-low'
    }
    if (finite(week52High) && finite(week52Low) && week52High > week52Low) {
      const position = (price - week52Low) / (week52High - week52Low)
      if (LOWER_PART_OF_RANGE.test(text) && position > 0.4) return 'range-position-lower'
      if (UPPER_PART_OF_RANGE.test(text) && position < 0.6) return 'range-position-upper'
    }
  }

  if (EARNINGS_WRONG_WINDOW.test(text)) return 'earnings-window'
  if (facts.earningsFound && EARNINGS_DENIED.test(text)) return 'earnings-denied'
  return null
}

/** Drops list items and replaces summary/action that contradict the facts; returns how many were removed. */
export function guardAiClaims(
  fields: GuardedAiFields,
  facts: AiClaimFacts,
  fallbackSummary: string,
): { fields: GuardedAiFields; removed: number } {
  let removed = 0
  const keep = (items: string[]) => items.filter(item => {
    if (findAiClaimViolation(item, facts) === null) return true
    removed += 1
    return false
  })
  const replace = (text: string) => {
    if (findAiClaimViolation(text, facts) === null) return text
    removed += 1
    return fallbackSummary
  }
  return {
    fields: {
      summary: replace(fields.summary),
      reasons: keep(fields.reasons),
      risks: keep(fields.risks),
      action: replace(fields.action),
    },
    removed,
  }
}

export interface ModelReply {
  text: string
  truncated: boolean
}

export interface ModelChainResult {
  text: string
  index: number
  usable: boolean
}

/**
 * Tries each model in order. A reply is accepted only when it is complete (not cut off at the token limit) and
 * usable. When none is usable the last non-empty reply is returned so the caller can fall back to the engine
 * summary; null means every model returned nothing.
 */
export async function runModelChain(
  attempts: Array<() => Promise<ModelReply>>,
  isUsable: (text: string) => boolean,
): Promise<ModelChainResult | null> {
  let lastNonEmpty: ModelChainResult | null = null
  for (let index = 0; index < attempts.length; index += 1) {
    const reply = await attempts[index]()
    if (!reply.text) continue
    if (!reply.truncated && isUsable(reply.text)) return { text: reply.text, index, usable: true }
    lastNonEmpty = { text: reply.text, index, usable: false }
  }
  return lastNonEmpty
}
