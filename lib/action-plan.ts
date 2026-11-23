// v1.41.51: สรุป "คำแนะนำวันนี้" ต่อหุ้นที่ถืออยู่ จากผลวิเคราะห์ล่าสุดที่บันทึกไว้แล้ว (ไม่เรียก AI)
// ฟังก์ชันบริสุทธิ์ ไม่มี runtime import (มีเฉพาะ import type) เพื่อให้เทสต์โหลดตรงด้วย strip-types
import type { AnalysisAction, DecisionTraceStep, DetailedAnalysisResult } from '@/types'

export type PlanGroup = 'SELL_ALL' | 'SELL_PARTIAL' | 'BUY' | 'HOLD' | 'NO_RESULT'

export const PLAN_GROUP_ORDER: PlanGroup[] = ['SELL_ALL', 'SELL_PARTIAL', 'BUY', 'HOLD', 'NO_RESULT']

export const PLAN_GROUP_LABEL: Record<PlanGroup, string> = {
  SELL_ALL: 'ขายทั้งหมด',
  SELL_PARTIAL: 'ขายบางส่วน',
  BUY: 'ช้อนเพิ่ม',
  HOLD: 'ถือต่อ',
  NO_RESULT: 'ยังไม่มีผลวิเคราะห์',
}

export type NumbersSource = 'structured' | 'text' | 'none'

export interface ActionPlanRow {
  symbol: string
  group: PlanGroup
  action: AnalysisAction | null
  // ป้ายเฉพาะ เช่น ช้อนเพิ่ม / ขายทำกำไร / ลดพอร์ต / ขายทั้งหมด / ถือต่อ
  label: string
  pct: number | null
  shares: number | null
  usd: number | null
  // ราคา ณ ตอนวิเคราะห์ (ใช้คำนวณ usd)
  price: number | null
  numbersSource: NumbersSource
  analysedAt: string | null
  analysisDate: string | null
  mode: string | null
  reason: string
  // ข้อความแผนเดิมจาก AI (ใช้แสดงเมื่อไม่มีตัวเลข)
  planText: string
  aiProposedAction: AnalysisAction | null
  guardSteps: DecisionTraceStep[]
  stale: boolean
}

export interface ActionPlanTotals {
  counts: Record<PlanGroup, number>
  buyUsd: number
  sellUsd: number
  // แถวที่ต้องซื้อ/ขายแต่ยังไม่มีตัวเลข (ผลเก่าที่อ่านข้อความไม่ได้)
  missingNumbers: number
  latestAnalysedAt: string | null
}

export interface ActionPlanInput {
  analyses: Record<string, DetailedAnalysisResult>
  analysisDates?: Record<string, string>
  staleSymbols?: string[]
  // หุ้นที่ถืออยู่ (shares > 0); ไม่ส่งมา = ใช้ symbol ที่มีผลวิเคราะห์
  heldSymbols?: string[]
}

const REASON_MAX_CHARS = 220

// "ช้อนเพิ่ม 15% (~12.5 หุ้น)" / "ขายทำกำไร 20% (~3.2 หุ้น)" / "ลดพอร์ต 10% (~1,234.5 หุ้น)" / "ขายทั้งหมด 100% (~8 หุ้น)"
// รูปแบบนี้มาจาก lib/position-sizing.ts (prependPlan) — ผลที่บันทึกก่อน v1.41.51 มีแต่ข้อความ
const PLAN_TEXT_PATTERN = /(ช้อนเพิ่ม|ขายทำกำไร|ลดพอร์ต|ขายทั้งหมด)\s+(\d+(?:\.\d+)?)%\s*\(~\s*(\d[\d,]*(?:\.\d+)?)\s*หุ้น\)/

export interface ParsedPlanText {
  label: string
  pct: number
  shares: number
}

export function parsePlanText(text: unknown): ParsedPlanText | null {
  if (typeof text !== 'string') return null
  const match = PLAN_TEXT_PATTERN.exec(text)
  if (!match) return null
  const pct = Number(match[2])
  const shares = Number(match[3].replace(/,/g, ''))
  if (!Number.isFinite(pct) || !Number.isFinite(shares) || shares < MIN_PLAN_SHARES) return null
  return { label: match[1], pct, shares }
}

const round2 = (value: number): number => Math.round(value * 100) / 100

// ป้ายที่ยอมรับได้ของแต่ละ action (ข้อความแผนที่ป้ายไม่ตรง action ถือว่าอ่านไม่ได้ ไม่เอามารวมยอด)
const ALLOWED_PLAN_LABELS: Record<'BUY' | 'SELL_PARTIAL' | 'SELL_ALL', string[]> = {
  BUY: ['ช้อนเพิ่ม'],
  SELL_PARTIAL: ['ขายทำกำไร', 'ลดพอร์ต'],
  SELL_ALL: ['ขายทั้งหมด'],
}
// จำนวนหุ้นต่ำกว่านี้ปัดเป็น 0 ในข้อความ (ทศนิยม 4 ตำแหน่ง) จึงไม่ถือเป็นแผน
const MIN_PLAN_SHARES = 0.0001

function validPrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function groupOf(action: AnalysisAction): PlanGroup {
  return action === 'SELL_ALL' ? 'SELL_ALL' : action === 'SELL_PARTIAL' ? 'SELL_PARTIAL' : action === 'BUY' ? 'BUY' : 'HOLD'
}

function compactReason(summary: unknown): string {
  if (typeof summary !== 'string') return ''
  return summary.replace(/\s+/g, ' ').trim().slice(0, REASON_MAX_CHARS)
}

function emptyRow(symbol: string, stale: boolean): ActionPlanRow {
  return {
    symbol,
    group: 'NO_RESULT',
    action: null,
    label: PLAN_GROUP_LABEL.NO_RESULT,
    pct: null,
    shares: null,
    usd: null,
    price: null,
    numbersSource: 'none',
    analysedAt: null,
    analysisDate: null,
    mode: null,
    reason: '',
    planText: '',
    aiProposedAction: null,
    guardSteps: [],
    stale,
  }
}

export function buildActionRow(
  symbol: string,
  result: DetailedAnalysisResult | undefined,
  analysisDate: string | null,
  stale: boolean,
): ActionPlanRow {
  if (!result || result.error || !result.recommendation) return { ...emptyRow(symbol, stale), analysisDate }

  const action = result.recommendation.action
  const group = groupOf(action)
  const price = validPrice(result.usedPrice)
  const planText = (action === 'BUY' ? result.recommendation.buyConditions : action === 'HOLD' ? '' : result.recommendation.sellConditions) ?? ''
  const base: ActionPlanRow = {
    ...emptyRow(symbol, stale),
    group,
    action,
    label: action === 'HOLD' ? PLAN_GROUP_LABEL.HOLD : PLAN_GROUP_LABEL[group],
    price,
    analysedAt: result.analysedAt ?? null,
    analysisDate,
    mode: result.analysisMode ?? null,
    reason: compactReason(result.summary),
    planText: typeof planText === 'string' ? planText : '',
    aiProposedAction: result.decisionTrace?.aiProposedAction ?? null,
    guardSteps: Array.isArray(result.decisionTrace?.steps) ? result.decisionTrace.steps : [],
  }
  if (action === 'HOLD') return base

  // ตัวเลขเชิงโครงสร้างใช้ได้เมื่อตรงกับ action สุดท้าย (guard ที่เปลี่ยน action จะล้างฟิลด์นี้ แต่ตรวจซ้ำอีกชั้น)
  const sizing = result.sizing
  if (sizing && sizing.action === action && Number.isFinite(sizing.shares) && sizing.shares >= MIN_PLAN_SHARES) {
    const sizingPrice = validPrice(sizing.price) ?? price
    return {
      ...base,
      label: sizing.label,
      pct: sizing.pct,
      shares: sizing.shares,
      price: sizingPrice,
      usd: typeof sizing.usd === 'number' && Number.isFinite(sizing.usd) ? sizing.usd : sizingPrice === null ? null : round2(sizing.shares * sizingPrice),
      numbersSource: 'structured',
    }
  }

  // ผลเก่า (ก่อน v1.41.51): อ่านจำนวนหุ้นจากข้อความแผนเดิม และคำนวณ USD จากราคา ณ ตอนวิเคราะห์
  const parsedText = parsePlanText(planText)
  const parsed = parsedText && ALLOWED_PLAN_LABELS[action].includes(parsedText.label) ? parsedText : null
  if (parsed) {
    return {
      ...base,
      label: parsed.label,
      pct: parsed.pct,
      shares: parsed.shares,
      usd: price === null ? null : round2(parsed.shares * price),
      numbersSource: 'text',
    }
  }
  return base
}

export function buildActionPlan(input: ActionPlanInput): { rows: ActionPlanRow[]; totals: ActionPlanTotals } {
  const analyses = input.analyses ?? {}
  const bySymbol = new Map<string, { result: DetailedAnalysisResult; date: string | null }>()
  for (const [symbol, result] of Object.entries(analyses)) {
    bySymbol.set(symbol.toUpperCase(), { result, date: input.analysisDates?.[symbol] ?? null })
  }
  const stale = new Set((input.staleSymbols ?? []).map(symbol => symbol.toUpperCase()))
  const symbols = (input.heldSymbols && input.heldSymbols.length > 0 ? input.heldSymbols : [...bySymbol.keys()])
    .map(symbol => symbol.toUpperCase())
  const unique = [...new Set(symbols)]

  const rows = unique.map(symbol => {
    const entry = bySymbol.get(symbol)
    return buildActionRow(symbol, entry?.result, entry?.date ?? null, stale.has(symbol))
  })

  rows.sort((a, b) => {
    const byGroup = PLAN_GROUP_ORDER.indexOf(a.group) - PLAN_GROUP_ORDER.indexOf(b.group)
    if (byGroup !== 0) return byGroup
    const byUsd = (b.usd ?? -1) - (a.usd ?? -1)
    return byUsd !== 0 ? byUsd : a.symbol.localeCompare(b.symbol)
  })

  const totals: ActionPlanTotals = {
    counts: { SELL_ALL: 0, SELL_PARTIAL: 0, BUY: 0, HOLD: 0, NO_RESULT: 0 },
    buyUsd: 0,
    sellUsd: 0,
    missingNumbers: 0,
    latestAnalysedAt: null,
  }
  let latestMs = -Infinity
  for (const row of rows) {
    totals.counts[row.group]++
    if (row.group === 'BUY' || row.group === 'SELL_PARTIAL' || row.group === 'SELL_ALL') {
      if (row.usd === null) totals.missingNumbers++
      else if (row.group === 'BUY') totals.buyUsd = round2(totals.buyUsd + row.usd)
      else totals.sellUsd = round2(totals.sellUsd + row.usd)
    }
    const ms = row.analysedAt ? Date.parse(row.analysedAt) : NaN
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms
      totals.latestAnalysedAt = row.analysedAt
    }
  }
  return { rows, totals }
}
