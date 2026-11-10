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

// Notes written by the system itself (execution guard, SELL_ALL downgrade, this guard) are never dropped. The
// generators join a downgrade note and the model text with " | " so a note never swallows model text.
const SYSTEM_PREFIX = /^\s*(?:Scale-in Guard|Execution Guard|ระบบปรับ|ระบบเตือน)/

// Splits on newlines, " | " and sentence ends; the capture group keeps the separators.
const SEGMENT_SPLIT = /(\n+|\s\|\s|(?<=[.!?])\s+)/

// The model also writes "ระดับสนับสนุน" / "แนวสนับสนุน" for the support level, so those count as "แนวรับ".
// The Cron batch prompt mostly writes "ราคาติดระดับสนับสนุน" / "ราคาติดเหนือค่า support" ("price is stuck to support"), so
// "ติด" and "ติดเหนือ" count as verbs too, and "ค่า" may sit before the noun. The 5% distance rule decides, as before.
const SUPPORT_CLAIM = /(?:ทดสอบ|แตะ|ชน|ใกล้|บริเวณ|อยู่ที่|ลงมาที่|ยืนที่|ติด(?:เหนือ)?)\s*(?:โซน|ระดับ|ค่า|บริเวณ|เส้น)?\s*(?:แนวรับ|แนวสนับสนุน|สนับสนุน|support)/gi
// "ราคาต่ำกว่า support 1.59" while the price is above it (or "เหนือ" while it is below). Not "หลุดแนวรับ": the app has more
// than one support level and the model may mean the other one. The comparison uses `technical.support`, the value both
// prompts show to the model.
// The gap between "ราคา" and the comparison word may hold a decimal point ("ราคาปัจจุบัน 1.74 ต่ำกว่า…") but no sentence end.
const PRICE_VS_SUPPORT = /ราคา((?:[^|.;\n]|(?<=\d)\.(?=\d)){0,24}?)(เหนือ|สูงกว่า|ต่ำกว่า|ใต้)\s*(?:โซน|ระดับ|ค่า|เส้น)?\s*(?:แนวรับ|แนวสนับสนุน|สนับสนุน|support)/gi
const SUPPORT_TOLERANCE = 0.0005
// Words inside the gap that make the sentence something other than a statement about the current price versus support:
// a condition or forecast ("ถ้า/หาก/เมื่อ/จะ/อาจ"), a requirement ("ต้อง/ควร"), the past ("เคย/ปิด"), or another price
// ("ต้นทุน/เฉลี่ย/ซื้อ/เป้า/คู่แข่ง/เดิม/ก่อน/เสี่ยง").
const SUPPORT_GAP_EXCLUDED = /ถ้า|หาก|เมื่อ|ในกรณี|จะ|อาจ|ต้อง|ควร|เคย|ปิด|ต้นทุน|เฉลี่ย|ซื้อ|เป้า|คู่แข่ง|เดิม|ก่อน|เสี่ยง/
// What may follow the support word when it is an older or someone else's level ("แนวรับเดิม", "แนวรับที่ 20 วัน",
// "แนวรับของตัวเอง") or the sentence is about the past ("…เมื่อวาน").
const SUPPORT_AFTER_EXCLUDED = /^\s*(?:เดิม|เก่า|ก่อน|เมื่อ|ของ|ที่\s*\d+\s*วัน)/
const EARNINGS_NOT_NEAR =
  /(?:ยัง)?ไม่(?:ได้)?(?:ใกล้(?!เคียง)|ถึง(?!เป้า|คาด|เกณฑ์|ประมาณ))[^|.\n]{0,14}?(?:ประกาศ(?:ผล|งบ)|earnings|ผลประกอบการ)|(?:ประกาศ(?:ผล|งบ)|earnings|ผลประกอบการ)[^|.\n]{0,18}?(?:ยัง)?ไม่(?:ได้)?(?:ใกล้(?!เคียง)|ถึง(?!เป้า|คาด|เกณฑ์|ประมาณ)|ภายใน)|earnings[^|.\n]{0,20}?(?:not|isn't|aren't)\s+(?:expected\s+)?(?:near|close|soon)|(?:ประกาศ(?:ผล|งบ)|ผลประกอบการ)[^|.\n]{0,12}?ยัง(?:อีกนาน|อีกไกล|ห่าง)|ยังอีกนาน[^|.\n]{0,12}?(?:ประกาศ(?:ผล|งบ)|ผลประกอบการ)/i
// "งบการเงิน" (financial statements) is deliberately not a mention of the announcement date. "ผลประกอบการ" is only a
// mention when it looks ahead ("ผลประกอบการที่ใกล้เข้ามา", "ผลประกอบการจะประกาศใน 4 วัน"), not in "หากผลประกอบการเป็นบวก",
// "ผลประกอบการไตรมาสที่ประกาศไปแล้ว" or "ใกล้เคียงเป้า". A denial such as "ผลประกอบการยังไม่ใกล้" is removed by
// EARNINGS_NOT_NEAR before this test runs, so it never counts as a mention.
const EARNINGS_MENTION =
  /ประกาศ(?:ผล|งบ)|earnings|งบไตรมาส|ผลประกอบการ[^|.\n]{0,24}?(?:ใกล้(?!เคียง)|จะประกาศ|ประกาศ(?:ใน|ภายใน|วัน)|ภายใน\s*\d+\s*วัน|อีก\s*\d+\s*วัน|\d+\s*วันข้างหน้า)/i

// "เพิ่ม" alone is ambiguous ("ควรเพิ่มความระวัง" is not about the position), so it only counts when followed by a
// position word or a clause end; "ซื้อเพิ่ม" / "ทยอยซื้อ" / "สะสม" are unambiguous.
const ADD = '(?:เพิ่ม(?=\\s*(?:สถานะ|ไม้|หุ้น|โพซิชัน|position|พอร์ต)|\\s*(?:[.,;]|$))|ซื้อเพิ่ม|ทยอยซื้อ|สะสม)'
// Two word orders: "เหมาะกับการซื้อเพิ่ม / ควรทยอยซื้อ" and "การซื้อเพิ่มในขนาดเล็กจึงเหมาะสม". In the second one the
// words between the two parts must be space-free, and hasAffirmedMatch drops a match that contains a negation
// ("ยังไม่เหมาะสม", "ไม่ค่อยเหมาะสม", "มิได้เหมาะสม", "ใช่ว่าจะเหมาะสม").
const SUITABLE = '(?:จึง)?(?:เหมาะสม|เหมาะ|น่าสนใจ|น่าซื้อ|คุ้มค่า)'
const NEGATION_INSIDE = /ไม่|มิได้|มิใช่|ใช่ว่า/
const BUY_ADVOCACY = new RegExp(
  `(?:เหมาะ(?:กับ|ที่จะ)?(?:การ)?\\s*${ADD}|ควร${ADD}|น่า${ADD}|แนะนำ(?:ให้)?${ADD}|(?:การ)?(?:ซื้อเพิ่ม|ทยอยซื้อ|สะสม|เพิ่มสถานะ|เพิ่มไม้)[^|.\\n\\s]{0,24}?${SUITABLE})`,
  'g',
)
const SELL_ADVOCACY =
  /(?:เหมาะ(?:กับ|ที่จะ)?(?:การ)?\s*(?:ขายทำกำไร|ขาย|ลดสถานะ|ปิดสถานะ)|ควร(?:ขายทำกำไร|ขาย|ลดสถานะ|ปิดสถานะ))/g

// "RSI อยู่ในโซน oversold (41)" while the stored RSI is 41.6. Only a direct statement about the RSI zone counts: the gap may
// hold a decimal number but not a near/forecast/condition/negation word, and the match is skipped when negated or conditional.
const RSI_ZONE_CLAIM = /(?:RSI|อาร์เอสไอ)((?:[^|.;\n]|(?<=\d)\.(?=\d)){0,30}?)(oversold|overbought|โอเวอร์โซลด์|โอเวอร์บอต|ขายมากเกินไป|ซื้อมากเกินไป)/gi
const RSI_GAP_EXCLUDED = /ใกล้|เกือบ|เริ่ม|ไม่|จะ|อาจ|ถ้า|หาก|เมื่อ|ต้อง|ควร|เคย|ก่อน|ที่ผ่านมา|ออกจาก|พ้น|หลุด|คล้าย/
const RSI_WEEKLY = /สัปดาห์|weekly|week/i
/** Oversold is claimed while RSI is clearly above the zone (or overbought while clearly below it). */
const RSI_OVERSOLD_MAX = 35
const RSI_OVERBOUGHT_MIN = 65

const NEGATED = /(?:ไม่ได้|มิได้|ไม่|ห่าง|ยังไม่)\s*$/
// A claim made inside a condition ("ถ้า…", "เมื่อ…", "หาก…") is a hypothesis, not an assertion about now. Thai text
// rarely has punctuation, so a condition word must sit in the SAME space-free run as the claim ("ควรเพิ่มสถานะเมื่อ…",
// "ถ้าราคาลงมาใกล้แนวรับ"); a condition in a neighbouring clause ("ราคาอยู่ที่แนวรับ ถ้ามองระยะยาว…") must not excuse it.
const CONDITIONAL_BEFORE_RUN = /(?:ถ้า|หาก|เมื่อ(?!วาน)|ในกรณีที่)[^\s|.\n]{0,24}$/
// Advice ("ควรเพิ่ม…") may also be conditional on a clause just before it ("หากราคาย่อ ควรทยอยซื้อ").
const CONDITIONAL_BEFORE_CLAUSE = /(?:ถ้า|หาก|เมื่อ(?!วาน)|ในกรณีที่)[^|.\n]{0,24}$/
// The run may not cross "เพื่อ" (purpose): in "แนะนำซื้อเพิ่มในปริมาณจำกัดเพื่อจับจังหวะ…เมื่อ RSI อยู่ในโซน…" the later "เมื่อ"
// describes the reason, not a condition on the advice (seen in EOSE on 2026-11-10, HOLD with a buy recommendation).
const CONDITIONAL_AFTER_RUN = /^(?:(?!เพื่อ)[^\s|.\n]){0,40}?(?:ต่อเมื่อ|ถ้า|หาก|เมื่อ(?!วาน)|หลังจาก|ถึงจะ)/
// A clause that is left over after a removal and cannot stand on its own.
const ORPHAN_CLAUSE = /^(?:ไม่|ถ้า|หาก|เมื่อ|ค่อย|แล้ว|และ|แต่|ก็|จึง|หรือ|ซึ่ง)$|^[\d.,$%\s]+$/

type Action = DetailedAnalysisResult['recommendation']['action']
const ACTIONS: readonly string[] = ['BUY', 'HOLD', 'SELL_PARTIAL', 'SELL_ALL']

interface GuardContext {
  facts: AiClaimFacts
  support: number | null
  /** Stored RSI(14) values the RSI-zone rule compares with; null when missing. */
  rsiDaily: number | null
  rsiWeekly: number | null
  earningsNear: boolean
  /** null when the result carries no valid action: the action rules are then skipped. */
  action: Action | null
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * True when a pattern matches and is neither negated just before it nor part of a condition. A "fact" claim ("price is
 * at support") is only excused by a condition wrapped around it; "advice" ("should add") can also be conditional on
 * a clause before it or on a word right after it.
 */
function isAffirmedMatch(text: string, match: RegExpMatchArray, kind: 'fact' | 'advice'): boolean {
  const start = match.index ?? 0
  const end = start + match[0].length
  const before = text.slice(Math.max(0, start - 30), start)
  if (NEGATED.test(text.slice(Math.max(0, start - 8), start))) return false
  if (NEGATION_INSIDE.test(match[0])) return false
  if (kind === 'fact') return !CONDITIONAL_BEFORE_RUN.test(before)
  return !CONDITIONAL_BEFORE_CLAUSE.test(before) && !CONDITIONAL_AFTER_RUN.test(text.slice(end, end + 48))
}

function hasAffirmedMatch(text: string, pattern: RegExp, kind: 'fact' | 'advice'): boolean {
  for (const match of text.matchAll(pattern)) {
    if (isAffirmedMatch(text, match, kind)) return true
  }
  return false
}

/** True when an affirmed "price is above/below support" claim points the wrong way for the stored price and support. */
function contradictsSupportDirection(text: string, price: number, support: number): boolean {
  for (const match of text.matchAll(PRICE_VS_SUPPORT)) {
    if (!isAffirmedMatch(text, match, 'fact')) continue
    if (SUPPORT_GAP_EXCLUDED.test(match[1])) continue
    const end = (match.index ?? 0) + match[0].length
    if (SUPPORT_AFTER_EXCLUDED.test(text.slice(end, end + 24))) continue
    const above = match[2] === 'เหนือ' || match[2] === 'สูงกว่า'
    const consistent = above ? price >= support * (1 - SUPPORT_TOLERANCE) : price <= support * (1 + SUPPORT_TOLERANCE)
    if (!consistent) return true
  }
  return false
}

/** True when an affirmed "RSI is oversold/overbought" claim points the wrong way for the stored RSI value. */
function contradictsRsiZone(text: string, rsiDaily: number | null, rsiWeekly: number | null): boolean {
  for (const match of text.matchAll(RSI_ZONE_CLAIM)) {
    if (!isAffirmedMatch(text, match, 'fact')) continue
    // "RSI" is written with spaces around it, so a condition word may sit in the previous space-separated clause.
    const start = match.index ?? 0
    if (CONDITIONAL_BEFORE_CLAUSE.test(text.slice(Math.max(0, start - 30), start))) continue
    if (RSI_GAP_EXCLUDED.test(match[1])) continue
    const rsi = RSI_WEEKLY.test(match[1]) ? rsiWeekly : rsiDaily
    if (!finite(rsi)) continue
    const oversold = /^(?:oversold|โอเวอร์โซลด์|ขายมากเกินไป)$/i.test(match[2])
    if (oversold ? rsi > RSI_OVERSOLD_MAX : rsi < RSI_OVERBOUGHT_MIN) return true
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
    if (Math.abs(price - ctx.support) / ctx.support > SUPPORT_DISTANCE_LIMIT && hasAffirmedMatch(segment, SUPPORT_CLAIM, 'fact')) {
      return 'price-near-support'
    }
    if (contradictsSupportDirection(segment, price, ctx.support)) return 'price-vs-support-direction'
  }
  if (contradictsRsiZone(segment, ctx.rsiDaily, ctx.rsiWeekly)) return 'rsi-zone'
  if (ctx.earningsNear && EARNINGS_NOT_NEAR.test(segment)) return 'earnings-not-near'
  if (ctx.action !== null && ctx.action !== 'BUY' && hasAffirmedMatch(segment, BUY_ADVOCACY, 'advice')) return 'buy-text-vs-action'
  if ((ctx.action === 'BUY' || ctx.action === 'HOLD') && hasAffirmedMatch(segment, SELL_ADVOCACY, 'advice')) return 'sell-text-vs-action'
  return null
}

/**
 * Thai text often has no sentence punctuation, so one "sentence" can hold several clauses separated by spaces. When a
 * sentence violates a rule, first try to drop only the clauses that violate on their own. If no single clause does
 * (the claim spans clauses), a leftover clause could not stand alone, or the rest still violates, the whole sentence goes.
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
  if (
    removed === 0 ||
    rest === '' ||
    kept.some(clause => clause.length < 6 || ORPHAN_CLAUSE.test(clause)) ||
    findPortfolioClaimViolation(rest, ctx) !== null
  ) {
    return { text: '', removed: 1 }
  }
  return { text: rest, removed }
}

/** Removes violating sentences/clauses from one text field; keeps system notes and the separators of what remains. */
function guardText<T>(text: T, ctx: GuardContext): { text: T | string; removed: number } {
  // Model output can be malformed (numbers, objects); anything that is not a non-empty string is left untouched.
  if (typeof text !== 'string' || !text) return { text, removed: 0 }
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

function guardList<T>(items: T, ctx: GuardContext): { items: T | string[]; removed: number } {
  if (!Array.isArray(items)) return { items, removed: 0 }
  let removed = 0
  const next: unknown[] = []
  for (const item of items) {
    const guarded = guardText(item, ctx)
    removed += guarded.removed
    if (guarded.removed > 0 && guarded.text === '') continue
    next.push(guarded.text)
  }
  return { items: next as string[], removed }
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

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

function runGuard(result: DetailedAnalysisResult): PortfolioGuardOutcome {
  const technical = result.technical
  const earnings = result.earnings ?? null
  const action = result.recommendation && ACTIONS.includes(result.recommendation.action) ? result.recommendation.action : null
  const ctx: GuardContext = {
    facts: {
      price: finite(result.usedPrice) ? result.usedPrice : null,
      ema50: finite(technical.ema50) ? technical.ema50 : null,
      ema200: finite(technical.ema200) ? technical.ema200 : null,
      week52High: finite(technical.week52High) ? technical.week52High : null,
      week52Low: finite(technical.week52Low) ? technical.week52Low : null,
      earningsFound: earnings !== null,
    },
    support: finite(technical.support) ? technical.support : null,
    rsiDaily: finite(technical.rsi14) ? technical.rsi14 : null,
    rsiWeekly: finite(technical.weeklyRsi14) ? technical.weeklyRsi14 : null,
    earningsNear: earnings !== null && Number.isFinite(earnings.daysUntil) && earnings.daysUntil >= 0 && earnings.daysUntil <= EARNINGS_NEAR_DAYS,
    action,
  }

  const rawRisksAndOpportunities = result.risksAndOpportunities as DetailedAnalysisResult['risksAndOpportunities'] | undefined | null
  const summary = guardText(result.summary, ctx)
  const technicalSummary = guardText(result.technicalSummary, ctx)
  const caution = guardText(rawRisksAndOpportunities?.caution, ctx)
  const opportunity = guardText(rawRisksAndOpportunities?.opportunity, ctx)
  const newsImpact = guardList(result.newsImpact, ctx)
  const risks = guardList(result.risks, ctx)
  const removed = summary.removed + technicalSummary.removed + caution.removed + opportunity.removed + newsImpact.removed + risks.removed

  // Never leave the two fields the UI depends on empty after a removal.
  const summaryValue = summary.removed > 0 && summary.text === ''
    ? `ระบบตัดข้อความ AI ที่ขัดกับตัวเลขที่คำนวณแล้ว คำแนะนำปัจจุบัน: ${action ?? 'ไม่ระบุ'}`
    : summary.text
  const technicalSummaryValue = technicalSummary.removed > 0 && technicalSummary.text === ''
    ? 'ระบบตัดข้อความเทคนิคัลของ AI ที่ขัดกับตัวเลขที่คำนวณแล้ว กรุณาดูตัวชี้วัดด้านล่าง'
    : technicalSummary.text

  let cautionValue: unknown = caution.text
  let noticeAdded = false
  const notice = earningsNotice(result)
  if (notice) {
    const allText = [
      asString(summaryValue), asString(technicalSummaryValue), asString(cautionValue), asString(opportunity.text),
      ...(Array.isArray(newsImpact.items) ? newsImpact.items.map(asString) : []),
      ...(Array.isArray(risks.items) ? risks.items.map(asString) : []),
      asString(result.recommendation?.buyConditions), asString(result.recommendation?.sellConditions),
    ].join('\n')
    if (!EARNINGS_MENTION.test(allText)) {
      cautionValue = [notice, asString(cautionValue)].filter(Boolean).join(' | ')
      noticeAdded = true
    }
  }

  if (removed === 0 && !noticeAdded) return { result, removed: 0, noticeAdded: false }

  return {
    result: {
      ...result,
      summary: summaryValue as string,
      technicalSummary: technicalSummaryValue as string,
      newsImpact: newsImpact.items as string[],
      risks: risks.items as string[],
      risksAndOpportunities: {
        caution: cautionValue as string,
        opportunity: opportunity.text as string,
      },
    },
    removed,
    noticeAdded,
  }
}

/** Pure function: returns the same object when nothing needs to change. Run it after the execution guard. */
export function guardPortfolioAnalysisText(result: DetailedAnalysisResult): PortfolioGuardOutcome {
  if (!result || typeof result !== 'object' || result.error || !result.technical || typeof result.technical !== 'object') {
    return { result, removed: 0, noticeAdded: false }
  }
  try {
    return runGuard(result)
  } catch (error) {
    // The guard must never take a route down: on any unexpected shape, show the original analysis.
    console.error(`[portfolio-ai-guard] ${typeof result.symbol === 'string' ? result.symbol : 'unknown'}: guard skipped after an error`, error)
    return { result, removed: 0, noticeAdded: false }
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
