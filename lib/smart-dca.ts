// Planning only: DIME is already part of total value, not an incoming deposit.
export interface DcaPosition { symbol: string; shares: number; price: number | null }
export interface DcaTarget { asset_key: string; target_pct: number }
export interface DcaParameters {
  budget: number
  cash_reserve: number
  max_position_pct: number
  fee_per_order: number
}
export interface DcaPlan {
  status: 'READY' | 'BLOCKED'
  portfolio_value: number | null
  effective_reserve: number | null
  available_budget: number
  invested: number
  fees: number
  remaining_dime: number | null
  rows: Array<{ symbol: string; price: number; shares: number; amount: number; fee: number; target_pct: number; projected_pct: number; reason: string }>
  warnings: string[]
}

const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,14}$/
const cents = (value: number) => Math.round(value * 100)
const floorCents = (value: number) => Math.floor(value * 100 + 1e-7)

export function parseDcaParameters(body: Record<string, unknown>): DcaParameters {
  const money = (key: string) => {
    const raw = body[key]
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-5) {
      throw new Error(`${key}: ต้องเป็นจำนวนเงิน 0–1,000,000,000 USD ทศนิยมไม่เกิน 2 ตำแหน่ง`)
    }
    return n
  }
  const rawCap = body.max_position_pct
  const cap = typeof rawCap === 'number' ? rawCap : typeof rawCap === 'string' && rawCap.trim() ? Number(rawCap) : NaN
  if (!Number.isFinite(cap) || cap <= 0 || cap > 30) throw new Error('เพดานรายหุ้นต้องมากกว่า 0 และไม่เกิน 30%')
  return { budget: money('budget'), cash_reserve: money('cash_reserve'), fee_per_order: money('fee_per_order'), max_position_pct: cap }
}

export function calculateDcaPlan(
  positions: DcaPosition[], targets: DcaTarget[], dimeBalance: number | null, input: DcaParameters,
): DcaPlan {
  // Validate even for direct callers; do not trust client amounts or non-finite values.
  const params = parseDcaParameters({ ...input })
  const base: DcaPlan = { status: 'BLOCKED', portfolio_value: null, effective_reserve: null, available_budget: 0, invested: 0, fees: 0, remaining_dime: dimeBalance, rows: [], warnings: [] }
  const blocked = (message: string) => ({ ...base, warnings: [message] })
  if (dimeBalance === null || !Number.isFinite(dimeBalance) || dimeBalance < 0) return blocked('ไม่พบยอด DIME ที่ถูกต้อง จึงไม่สร้างแผน')
  const keys = new Set<string>()
  if (!targets.length || targets.some(t => {
    const invalid = keys.has(t.asset_key) || (t.asset_key !== 'DIME' && !SYMBOL.test(t.asset_key)) || !Number.isFinite(t.target_pct) || t.target_pct < 0 || t.target_pct > 100
    keys.add(t.asset_key)
    return invalid
  }) || Math.abs(targets.reduce((s, t) => s + t.target_pct, 0) - 100) > 0.01) return blocked('ต้องตั้ง Target Allocation ที่ไม่ซ้ำและรวม 100% ก่อน')
  const holdings = new Map<string, DcaPosition>()
  for (const p of positions) {
    if (!SYMBOL.test(p.symbol) || holdings.has(p.symbol) || !Number.isFinite(p.shares) || p.shares < 0 || p.shares > 999_999_999.999999) return blocked('ข้อมูล Holdings ไม่ครบหรือไม่ถูกต้อง')
    holdings.set(p.symbol, p)
    if (p.shares > 0 && (p.price === null || !Number.isFinite(p.price) || p.price <= 0)) return blocked(`ราคา ${p.symbol} ไม่พร้อม จึงคำนวณมูลค่าพอร์ตรวมไม่ได้`)
  }
  const equity = positions.reduce((s, p) => s + floorCents(p.shares * (p.price ?? 0)), 0)
  const dime = floorCents(dimeBalance)
  const total = equity + dime
  if (!Number.isSafeInteger(total) || total <= 0) return blocked('มูลค่าพอร์ตไม่อยู่ในขอบเขตที่คำนวณได้')
  base.portfolio_value = total / 100
  const cashTarget = targets.find(t => t.asset_key === 'DIME')?.target_pct ?? 0
  const reserve = Math.max(cents(params.cash_reserve), Math.ceil(total * (cashTarget / 100)))
  base.effective_reserve = reserve / 100
  const budget = Math.min(cents(params.budget), Math.max(0, dime - reserve))
  base.available_budget = budget / 100
  if (budget <= 0) return blocked('ไม่มีงบหลังหัก Cash Reserve และ DIME Target หรือยังไม่ได้ระบุงบ')
  const candidates: Array<{ symbol: string; price: number; value: number; pct: number }> = []
  for (const t of [...targets].sort((a, b) => a.asset_key.localeCompare(b.asset_key))) {
    if (t.asset_key === 'DIME' || t.target_pct === 0) continue
    const p = holdings.get(t.asset_key)
    const value = floorCents((p?.shares ?? 0) * (p?.price ?? 0))
    if (value >= total * Math.min(t.target_pct, params.max_position_pct) / 100) continue
    if (!p || p.price === null || !Number.isFinite(p.price) || p.price <= 0) return blocked(`ราคา ${t.asset_key} ไม่พร้อม จึงไม่สร้างแผนซื้อ`)
    candidates.push({ symbol: t.asset_key, price: p.price, value, pct: t.target_pct })
  }
  const fee = cents(params.fee_per_order)
  // Reserve fees conservatively for every candidate; cap weights use value AFTER fees.
  const feeReserve = candidates.length * fee
  const afterFees = total - feeReserve
  const buyBudget = budget - feeReserve
  if (buyBudget <= 0 || afterFees <= 0) return blocked('งบไม่พอหลังสำรองค่าธรรมเนียม')
  const needs = candidates.map(p => ({ ...p, need: Math.max(0, Math.floor(afterFees * Math.min(p.pct, params.max_position_pct) / 100 - p.value)) })).filter(p => p.need > 0)
  const totalNeed = needs.reduce((s, p) => s + p.need, 0)
  if (!totalNeed) return blocked('ไม่มีหุ้น Underweight ที่ซื้อเพิ่มได้ภายในเพดานรายหุ้น')
  const pool = Math.min(buyBudget, totalNeed)
  const allocations = needs.map(p => {
    const raw = pool * (p.need / totalNeed)
    return { ...p, allocation: Math.floor(raw), remainder: raw - Math.floor(raw) }
  })
  let left = pool - allocations.reduce((s, p) => s + p.allocation, 0)
  for (const p of [...allocations].sort((a, b) => b.remainder - a.remainder || a.symbol.localeCompare(b.symbol))) {
    if (left > 0 && p.allocation < p.need) { p.allocation++; left-- }
  }
  for (const p of allocations) {
    const shares = Math.min(999_999_999.999999, Math.floor((p.allocation / 100 / p.price) * 1_000_000) / 1_000_000)
    const amount = Math.ceil(shares * p.price * 100 - 1e-7)
    if (shares <= 0 || amount <= 0 || amount > p.allocation) continue
    base.rows.push({ symbol: p.symbol, price: p.price, shares, amount: amount / 100, fee: fee / 100, target_pct: p.pct, projected_pct: (p.value + amount) / afterFees * 100, reason: `Underweight: จัดสรรตาม gap ถึง Target ${p.pct}% จำกัดรายหุ้น ${params.max_position_pct}%` })
  }
  const spent = base.rows.reduce((s, p) => s + cents(p.amount), 0)
  const actualFees = base.rows.length * fee
  for (const row of base.rows) {
    const position = holdings.get(row.symbol)
    const current = floorCents((position?.shares ?? 0) * (position?.price ?? 0))
    row.projected_pct = (current + cents(row.amount)) / (total - actualFees) * 100
  }
  base.invested = spent / 100
  base.fees = actualFees / 100
  base.remaining_dime = (dime - spent - actualFees) / 100
  base.status = base.rows.length ? 'READY' : 'BLOCKED'
  if (params.budget * 100 > budget) base.warnings.push('ลดงบตาม DIME หลังหัก reserve; ไม่ใช้เงินในธนาคาร')
  if (!base.rows.length) base.warnings.push('งบไม่พอสำหรับจำนวนหุ้นขั้นต่ำ 0.000001 หุ้น')
  base.warnings.push('เป็นแผนจากราคาที่อ่านได้ ไม่รับประกันราคา execution และไม่สร้าง BUY/SELL')
  return base
}
