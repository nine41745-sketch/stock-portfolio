// Deterministic guard around the AI text of a portfolio analysis (manual "วิเคราะห์ AI" button and both crons).
// The model only explains numbers the system already computed, so a sentence that contradicts those numbers or the
// final action is dropped instead of shown, and a near earnings date that the text never mentions is added by the
// system. No model call is made. Rules are intentionally narrow and number-based: they catch the contradictions
// seen in production (support, earnings proximity, action vs. text) and the EMA / 52-week claims already covered by
// the Stock Check guard, not every possible wrong sentence.
import { findAiClaimViolation, type AiClaimFacts } from '@/lib/stock-check-ai-guard'
import type { DetailedAnalysisResult } from '@/types'

/** "At support" claims are rejected when the price is further than this from `technical.support` (the value the prompt shows). */
export const SUPPORT_DISTANCE_LIMIT = 0.05
/** Same threshold the analysis prompt uses to ask for an earnings warning. */
export const EARNINGS_NEAR_DAYS = 7

// Notes written by the system itself (execution guard, SELL_ALL downgrade, this guard) are never dropped.
const SYSTEM_PREFIX = /^\s*(?:Scale-in Guard|Execution Guard|ระบบปรับ|ระบบเตือน)/

// Splits on newlines, " | " and sentence ends; the capture group keeps the separators.
const SEGMENT_SPLIT = /(\n+|\s\|\s|(?<=[.!?])\s+)/

const SUPPORT_CLAIM = /(?:ทดสอบ|แตะ|ชน|ใกล้|บริเวณ|อยู่ที่|ลงมาที่|ยืนที่)\s*(?:โซน|ระดับ|บริเวณ|เส้น)?\s*(?:แนวรับ|support)/gi
const EARNINGS_NOT_NEAR =
  /(?:ยัง)?ไม่(?:ใกล้|ถึง)[^|.\n]{0,14}?(?:ประกาศ(?:ผล|งบ)|earnings)|(?:ประกาศ(?:ผล|งบ)|earnings)[^|.\n]{0,18}?(?:ยัง)?ไม่(?:ใกล้|ถึง|ภายใน)/i
const EARNINGS_MENTION = /ประกาศ(?:ผล|งบ)|earnings|งบการเงิน/i
const BUY_ADVOCACY =
  /(?:เหมาะ(?:กับ|ที่จะ)?(?:การ)?\s*(?:เพิ่ม|ซื้อเพิ่ม|ทยอยซื้อ|สะสม)|ควร(?:เพิ่ม|ซื้อเพิ่ม|ทยอยซื้อ|สะสม)|น่า(?:เพิ่ม|ซื้อเพิ่ม|สะสม)|แนะนำ(?:ให้)?(?:เพิ่ม|ซื้อเพิ่ม|ทยอยซื้อ))/g
const SELL_ADVOCACY =
  /(?:เหมาะ(?:กับ|ที่จะ)?(?:การ)?\s*(?:ขายทำกำไร|ขาย|ลดสถานะ|ปิดสถานะ)|ควร(?:ขายทำกำไร|ขาย|ลดสถานะ|ปิดสถานะ))/g
const NEGATED = /(?:ไม่|ห่าง|ยังไม่)\s*$/
const CONDITIONAL = /^\s*(?:ก็)?(?:เมื่อ|ต่อเมื่อ|ถ้า|หาก)/

type Action = DetailedAnalysisResult['recommendation']['action']

interface GuardContext {
  facts: AiClaimFacts
  support: number | null
  earningsNear: boolean
  action: Action
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** True when a pattern matches and is neither negated just before it nor made conditional just after it. */
function hasAffirmedMatch(text: string, pattern: RegExp, allowConditional: boolean): boolean {
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (NEGATED.test(text.slice(Math.max(0, start - 8), start))) continue
    if (allowConditional && CONDITIONAL.test(text.slice(start + match[0].length, start + match[0].length + 8))) continue
    return true
  }
  return false
}

/** Returns a short rule name when one segment of AI text contradicts the computed facts, otherwise null. */
export function findPortfolioClaimViolation(segment: string, ctx: GuardContext): string | null {
  if (SYSTEM_PREFIX.test(segment)) return null
  const base = findAiClaimViolation(segment, ctx.facts)
  if (base) return base

  const { price } = ctx.facts
  if (finite(price) && finite(ctx.support) && ctx.support > 0) {
    if (Math.abs(price - ctx.support) / ctx.support > SUPPORT_DISTANCE_LIMIT && hasAffirmedMatch(segment, SUPPORT_CLAIM, false)) {
      return 'price-near-support'
    }
  }
  if (ctx.earningsNear && EARNINGS_NOT_NEAR.test(segment)) return 'earnings-not-near'
  if (ctx.action !== 'BUY' && hasAffirmedMatch(segment, BUY_ADVOCACY, true)) return 'buy-text-vs-action'
  if (ctx.action === 'BUY' && hasAffirmedMatch(segment, SELL_ADVOCACY, true)) return 'sell-text-vs-action'
  return null
}

/**
 * Thai text often has no sentence punctuation, so one "sentence" can hold several clauses separated by spaces. When a
 * sentence violates a rule, first try to drop only the clauses that violate on their own. If no single clause does
 * (the claim spans clauses) or the rest still violates, the whole sentence goes.
 */
function narrowViolation(segment: string, ctx: GuardContext): { text: string; removed: number } {
  const pieces = segment.split(/(\s+)/)
  const kept: string[] = []
  let removed = 0
  for (let i = 0; i < pieces.length; i += 2) {
    const clause = pieces[i]
    if (clause === '') continue
    if (findPortfolioClaimViolation(clause, ctx) !== null) {
      removed += 1
      continue
    }
    kept.push(clause)
  }
  const rest = kept.join(' ').trim()
  if (removed === 0 || rest === '' || findPortfolioClaimViolation(rest, ctx) !== null) return { text: '', removed: 1 }
  return { text: rest, removed }
}

/** Removes violating sentences/clauses from one text field; keeps system notes and the separators of what remains. */
function guardText(text: string, ctx: GuardContext): { text: string; removed: number } {
  if (!text) return { text, removed: 0 }
  const parts = text.split(SEGMENT_SPLIT)
  const kept: Array<{ segment: string; separator: string }> = []
  let removed = 0
  for (let i = 0; i < parts.length; i += 2) {
    const segment = parts[i]
    const separator = parts[i + 1] ?? ''
    if (segment.trim() === '') continue
    if (findPortfolioClaimViolation(segment, ctx) !== null) {
      const narrowed = narrowViolation(segment, ctx)
      removed += narrowed.removed
      if (narrowed.text !== '') kept.push({ segment: narrowed.text, separator })
      continue
    }
    kept.push({ segment, separator })
  }
  if (removed === 0) return { text, removed: 0 }
  const joined = kept.map((item, index) => (index < kept.length - 1 ? item.segment + (item.separator || ' ') : item.segment)).join('')
  return { text: joined.trim(), removed }
}

function guardList(items: string[], ctx: GuardContext): { items: string[]; removed: number } {
  let removed = 0
  const next: string[] = []
  for (const item of items) {
    const guarded = typeof item === 'string' ? guardText(item, ctx) : { text: item as string, removed: 0 }
    removed += guarded.removed
    if (guarded.removed > 0 && guarded.text === '') continue
    next.push(guarded.text)
  }
  return { items: next, removed }
}

function earningsNotice(result: DetailedAnalysisResult): string | null {
  const earnings = result.earnings
  if (!earnings || !Number.isFinite(earnings.daysUntil) || earnings.daysUntil < 0 || earnings.daysUntil > EARNINGS_NEAR_DAYS) return null
  const when = earnings.daysUntil === 0 ? 'วันนี้' : `ในอีก ${earnings.daysUntil} วัน`
  return `ระบบเตือน: ประกาศงบ${when} (${earnings.date}${earnings.hour ? `, ${earnings.hour}` : ''}) ราคาอาจผันผวนแรง`
}

export interface PortfolioGuardOutcome {
  result: DetailedAnalysisResult
  removed: number
  noticeAdded: boolean
}

/** Pure function: returns the same object when nothing needs to change. Run it after the execution guard. */
export function guardPortfolioAnalysisText(result: DetailedAnalysisResult): PortfolioGuardOutcome {
  if (!result || result.error || !result.technical) return { result, removed: 0, noticeAdded: false }

  const technical = result.technical
  const earnings = result.earnings ?? null
  const ctx: GuardContext = {
    facts: {
      price: finite(result.usedPrice) ? result.usedPrice : null,
      ema50: technical.ema50 ?? null,
      ema200: technical.ema200 ?? null,
      week52High: null,
      week52Low: null,
      earningsFound: earnings !== null,
    },
    support: technical.support ?? null,
    earningsNear: earnings !== null && Number.isFinite(earnings.daysUntil) && earnings.daysUntil >= 0 && earnings.daysUntil <= EARNINGS_NEAR_DAYS,
    action: result.recommendation.action,
  }

  let removed = 0
  const summary = guardText(result.summary ?? '', ctx)
  const technicalSummary = guardText(result.technicalSummary ?? '', ctx)
  const caution = guardText(result.risksAndOpportunities?.caution ?? '', ctx)
  const opportunity = guardText(result.risksAndOpportunities?.opportunity ?? '', ctx)
  const newsImpact = guardList(result.newsImpact ?? [], ctx)
  const risks = guardList(result.risks ?? [], ctx)
  removed += summary.removed + technicalSummary.removed + caution.removed + opportunity.removed + newsImpact.removed + risks.removed

  // Never leave the two fields the UI depends on empty after a removal.
  const summaryText = summary.removed > 0 && summary.text === ''
    ? `ระบบตัดข้อความ AI ที่ขัดกับตัวเลขที่คำนวณแล้ว คำแนะนำปัจจุบัน: ${ctx.action}`
    : summary.text
  const technicalSummaryText = technicalSummary.removed > 0 && technicalSummary.text === ''
    ? 'ระบบตัดข้อความเทคนิคัลของ AI ที่ขัดกับตัวเลขที่คำนวณแล้ว กรุณาดูตัวชี้วัดด้านล่าง'
    : technicalSummary.text

  let cautionText = caution.text
  let noticeAdded = false
  const notice = earningsNotice(result)
  if (notice) {
    const allText = [
      summaryText, technicalSummaryText, cautionText, opportunity.text, ...newsImpact.items, ...risks.items,
      result.recommendation.buyConditions ?? '', result.recommendation.sellConditions ?? '',
    ].join('\n')
    if (!EARNINGS_MENTION.test(allText)) {
      cautionText = [notice, cautionText].filter(Boolean).join(' | ')
      noticeAdded = true
    }
  }

  if (removed === 0 && !noticeAdded) return { result, removed: 0, noticeAdded: false }

  return {
    result: {
      ...result,
      summary: summaryText,
      technicalSummary: technicalSummaryText,
      newsImpact: newsImpact.items,
      risks: risks.items,
      risksAndOpportunities: { caution: cautionText, opportunity: opportunity.text },
    },
    removed,
    noticeAdded,
  }
}

/** Call-site wrapper: applies the guard and logs counts only (no amounts, no text). */
export function applyPortfolioAiClaimGuard(result: DetailedAnalysisResult): DetailedAnalysisResult {
  const outcome = guardPortfolioAnalysisText(result)
  if (outcome.removed > 0 || outcome.noticeAdded) {
    console.warn(`[portfolio-ai-guard] ${result.symbol}: removed ${outcome.removed} claim(s), earnings notice added: ${outcome.noticeAdded}`)
  }
  return outcome.result
}
