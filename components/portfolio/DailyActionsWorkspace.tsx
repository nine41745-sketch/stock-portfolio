'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildActionPlan, PLAN_GROUP_LABEL, PLAN_GROUP_ORDER, type ActionPlanRow, type PlanGroup } from '@/lib/action-plan'
import type { DetailedAnalysisResult } from '@/types'

interface DailyAnalysesPayload {
  analyses?: Record<string, DetailedAnalysisResult>
  analysisDates?: Record<string, string>
  staleSymbols?: string[]
  heldSymbols?: string[]
  latestDailyAnalysisDate?: string | null
  latestDailyCronRun?: { run_date: string; status: string; processed: number; failed: number; rate_limited: number } | null
}

const BANGKOK_TIME_ZONE = 'Asia/Bangkok'

const GROUP_STYLE: Record<PlanGroup, string> = {
  SELL_ALL: 'bg-red-500/15 text-red-400 border-red-500/30',
  SELL_PARTIAL: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  BUY: 'bg-green-500/15 text-green-400 border-green-500/30',
  HOLD: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  NO_RESULT: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

const GROUP_ICON: Record<PlanGroup, string> = {
  SELL_ALL: '🔴',
  SELL_PARTIAL: '🟠',
  BUY: '🟢',
  HOLD: '🟡',
  NO_RESULT: '⚪',
}

const MODE_LABEL: Record<string, string> = {
  DAILY_POST_CLOSE: 'รอบหลังตลาดปิด',
  PREMARKET_TRIGGER: 'รอบก่อนตลาดเปิด',
  MANUAL: 'วิเคราะห์เอง',
}

// ต้องตรงกับ DECISION_GUARD_LABEL ใน PortfolioDashboard (ป้ายว่า guard ตัวไหนเปลี่ยนคำแนะนำของ AI)
const GUARD_LABEL: Record<string, string> = {
  SELL_ALL_EVIDENCE: 'ไม่มีหลักฐานว่าพื้นฐานบริษัทเสียจริง (กฎ SELL_ALL)',
  BUY_CASH: 'เงินที่พร้อมใช้ไม่พอไม้ขั้นต่ำ',
  BUY_CAPACITY: 'ชนเพดานสัดส่วนหุ้นในพอร์ต',
  EXECUTION_GUARD: 'เพิ่งขายไปใน 24 ชั่วโมง (Execution Guard)',
  SCALE_IN_GUARD: 'ด่านกันซื้อซ้ำ (Scale-in Guard)',
}

const ACTION_LABEL: Record<string, string> = {
  BUY: 'ช้อนเพิ่ม',
  HOLD: 'ถือต่อ',
  SELL_PARTIAL: 'ขายบางส่วน',
  SELL_ALL: 'ขายทั้งหมด',
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: BANGKOK_TIME_ZONE }) +
    ' เวลา ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BANGKOK_TIME_ZONE }) + ' น.'
}

const fmtUsd = (value: number): string => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtShares = (value: number): string => value.toLocaleString('en-US', { maximumFractionDigits: 4 })

function RowCard({ row }: { row: ActionPlanRow }) {
  const hasNumbers = row.shares !== null
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4" data-testid={`daily-action-row-${row.symbol}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-white">{row.symbol}</span>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${GROUP_STYLE[row.group]}`}>
              {GROUP_ICON[row.group]} {row.label}
            </span>
            {row.stale && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300" data-testid="daily-action-stale">
                ⚠️ พอร์ตถูกแก้หลังวิเคราะห์ ตัวเลขอาจไม่ตรง
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500" data-testid="daily-action-time">
            {row.analysedAt
              ? <>วิเคราะห์ล่าสุด {fmtDateTime(row.analysedAt)} · {MODE_LABEL[row.mode ?? 'MANUAL'] ?? 'วิเคราะห์เอง'}</>
              : 'ยังไม่มีผลวิเคราะห์ของหุ้นตัวนี้'}
          </p>
        </div>

        {row.group !== 'HOLD' && row.group !== 'NO_RESULT' && (
          <div className="text-right" data-testid="daily-action-numbers">
            {hasNumbers ? (
              <>
                <p className="text-base font-bold text-white">
                  {fmtShares(row.shares as number)} หุ้น{row.usd !== null ? <span className="text-gray-300"> ≈ {fmtUsd(row.usd)}</span> : null}
                </p>
                <p className="text-[11px] text-gray-500">
                  {row.pct !== null ? `${row.pct}% ของที่ถือ` : ''}{row.price !== null ? ` · ราคา ${fmtUsd(row.price)} ตอนวิเคราะห์` : ''}
                </p>
              </>
            ) : (
              <p className="max-w-xs text-xs text-gray-500">ผลนี้ไม่มีตัวเลขจำนวนหุ้น รอรอบวิเคราะห์ถัดไปหรือกด “วิเคราะห์ใหม่”</p>
            )}
          </div>
        )}
      </div>

      {row.aiProposedAction && row.guardSteps.length > 0 && (
        <p className="mt-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2 text-xs text-gray-300" data-testid="daily-action-trace">
          🤖 AI เสนอ: {ACTION_LABEL[row.aiProposedAction] ?? row.aiProposedAction} → ระบบสั่งสุทธิ: {ACTION_LABEL[row.action ?? 'HOLD'] ?? row.action} เพราะ{' '}
          {row.guardSteps.map(step => GUARD_LABEL[step.guard] ?? step.guard).join(' แล้ว ')}
        </p>
      )}

      {row.reason && <p className="mt-2 text-sm text-gray-400">{row.reason}</p>}
      {!hasNumbers && row.planText && row.group !== 'HOLD' && row.group !== 'NO_RESULT' && (
        <p className="mt-1 text-xs text-gray-500">แผนจาก AI: {row.planText}</p>
      )}
    </div>
  )
}

export default function DailyActionsWorkspace() {
  const [data, setData] = useState<DailyAnalysesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [running, setRunning] = useState<{ index: number; total: number; symbol: string } | null>(null)
  const [runMessage, setRunMessage] = useState<string | null>(null)
  // v1.41.53: ยืนยันในหน้าแทน window.confirm (เบราว์เซอร์ฝังในแอปปิดกล่อง confirm เงียบๆ และถือว่ากดยกเลิก ทำให้ปุ่มดูเหมือนไม่ทำงาน)
  const [confirming, setConfirming] = useState(false)
  const reanalyzeButtonRef = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  // กันกดซ้ำ/ซ้อนกันได้แน่นกว่า state (state อัปเดตหลัง render)
  const runningRef = useRef(false)

  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // คืนโฟกัสคีย์บอร์ดให้ปุ่มหลักเมื่อกล่องยืนยันถูกปิดโดยไม่เริ่มวิเคราะห์ (ปุ่มจะถูกปิดใช้งานระหว่างที่กล่องเปิดและระหว่างวิเคราะห์)
  useEffect(() => {
    if (wasConfirming.current && !confirming) {
      // v1.41.54: หลังกด "ยืนยัน" ปุ่มหัวถูกปิดใช้งานทันที focus() จะไม่ทำงานและโฟกัสหลุดไป body จึงย้ายโฟกัสไปที่พื้นที่ทำงานแทน
      const button = reanalyzeButtonRef.current
      ;(button && !button.disabled ? button : workspaceRef.current)?.focus()
    }
    wasConfirming.current = confirming
  }, [confirming])

  // โหลดผลวิเคราะห์ที่บันทึกไว้ (โหลดใหม่เมื่อ reloadKey เปลี่ยน เช่นหลังวิเคราะห์ใหม่เสร็จ)
  useEffect(() => {
    let cancelled = false
    fetch('/api/daily-analyses/today', { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`daily analyses ${response.status}`)
        return response.json() as Promise<DailyAnalysesPayload>
      })
      .then(payload => {
        if (cancelled) return
        setData(payload)
        setLoadFailed(false)
      })
      .catch(() => { if (!cancelled) setLoadFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  const plan = useMemo(() => buildActionPlan({
    analyses: data?.analyses ?? {},
    analysisDates: data?.analysisDates,
    staleSymbols: data?.staleSymbols,
    heldSymbols: data?.heldSymbols,
  }), [data])

  const heldCount = data?.heldSymbols?.length ?? plan.rows.length
  const cronRun = data?.latestDailyCronRun
  // ผลจาก /api/analyze ไม่มี analysisMode (null) หรือเป็น MANUAL — คิดงบซื้อแยกทีละตัว ต่างจาก cron ที่แชร์งบก้อนเดียว
  const hasManualBuy = plan.rows.some(row => row.group === 'BUY' && (row.mode === null || row.mode === 'MANUAL'))
  const staleOrderCount = plan.rows.filter(row => row.stale && (row.group === 'BUY' || row.group === 'SELL_PARTIAL' || row.group === 'SELL_ALL')).length

  // วิเคราะห์ใหม่ทีละตัวผ่าน /api/analyze เดิม — เรียกจากปุ่ม "ยืนยัน" ในกล่องยืนยันเท่านั้น (guard/แคช/การบันทึกผลชุดเดียวกับเดิม) หยุดเมื่อโควตา AI เต็ม
  async function reanalyzeAll() {
    const symbols = [...(data?.heldSymbols ?? [])]
    // v1.41.54: ปิดกล่องยืนยันก่อนเสมอ แม้ไม่มีหุ้นหรือกำลังวิเคราะห์อยู่ (ไม่ให้กล่องค้างหลังกด "ยืนยัน")
    setConfirming(false)
    if (symbols.length === 0 || runningRef.current) return
    runningRef.current = true
    setRunMessage(null)
    let failed = 0
    let stoppedForQuota = false
    let sessionExpired = false
    try {
      for (let i = 0; i < symbols.length; i++) {
        // ออกจากหน้าแล้วต้องหยุดเรียก API ทันที (ไม่ใช้โควตา AI ต่อโดยไม่มีคนดู)
        if (!mounted.current) return
        const symbol = symbols[i]
        setRunning({ index: i + 1, total: symbols.length, symbol })
        try {
          const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol }),
          })
          if (!response.ok) {
            failed++
            // 401/403 = ล็อกอิน/PIN หมดอายุ ยิงต่อก็ล้มทุกตัว
            if (response.status === 401 || response.status === 403) { sessionExpired = true; break }
            continue
          }
          const result = await response.json() as DetailedAnalysisResult
          if (result.error === 'RATE_LIMIT') { stoppedForQuota = true; break }
          if (result.error) failed++
        } catch {
          failed++
        }
      }
      if (!mounted.current) return
      setRunning(null)
      setRunMessage(sessionExpired
        ? 'เซสชันหมดอายุหรือยังไม่ได้ปลดล็อก PIN หยุดวิเคราะห์ กรุณาเข้าสู่ระบบ/ปลดล็อกแล้วลองใหม่'
        : stoppedForQuota
          ? 'โควตา AI เต็ม หยุดวิเคราะห์ ตัวที่เหลือยังเป็นผลเดิม ลองใหม่ภายหลัง'
          : failed > 0 ? `วิเคราะห์ไม่สำเร็จ ${failed} ตัว ตัวนั้นยังเป็นผลเดิม` : 'วิเคราะห์ใหม่เสร็จแล้ว')
      setReloadKey(key => key + 1)
    } finally {
      runningRef.current = false
    }
  }


  return (
    <div ref={workspaceRef} tabIndex={-1} className="space-y-4 outline-none" data-testid="daily-actions-workspace">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white md:text-2xl">✅ คำแนะนำวันนี้</h1>
          <p className="mt-1 text-sm text-gray-400">
            สรุปผลวิเคราะห์ล่าสุดของหุ้นที่ถืออยู่ว่าตัวไหนควรถือต่อ ช้อนเพิ่ม หรือขาย พร้อมจำนวนหุ้นและมูลค่า (USD) · อ่านจากผลที่ระบบวิเคราะห์ไว้แล้ว ไม่เรียก AI ซ้ำ
          </p>
        </div>
        <button
          ref={reanalyzeButtonRef}
          type="button"
          onClick={() => setConfirming(true)}
          disabled={loading || running !== null || confirming || (data?.heldSymbols?.length ?? 0) === 0}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          data-testid="daily-actions-reanalyze"
        >
          {running ? `กำลังวิเคราะห์ ${running.symbol} (${running.index}/${running.total})` : '🔄 วิเคราะห์ใหม่'}
        </button>
      </header>

      {confirming && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-3 text-sm text-blue-100" role="alertdialog" aria-label="ยืนยันการวิเคราะห์ใหม่" onKeyDown={event => { if (event.key === 'Escape') setConfirming(false) }} data-testid="daily-actions-confirm">
          <p>
            วิเคราะห์ใหม่ {data?.heldSymbols?.length ?? 0} ตัว จะใช้โควตา AI {data?.heldSymbols?.length ?? 0} คำขอ และอาจใช้เวลาหลายนาที ผลใหม่จะแทนที่ผลที่แสดงอยู่ ทำต่อไหม?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void reanalyzeAll()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500" data-testid="daily-actions-confirm-yes">ยืนยัน วิเคราะห์ใหม่</button>
            <button type="button" autoFocus onClick={() => setConfirming(false)} className="rounded-lg border border-gray-600 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800" data-testid="daily-actions-confirm-no">ยกเลิก</button>
          </div>
        </div>
      )}
      {loadFailed && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300" data-testid="daily-actions-load-failed">
          ⚠️ โหลดผลวิเคราะห์ไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง
        </p>
      )}
      {runMessage && <p className="rounded-lg border border-gray-700 bg-gray-900/50 px-3 py-2 text-sm text-gray-300" data-testid="daily-actions-run-message">{runMessage}</p>}
      {cronRun && ['failed', 'partial', 'rate_limited'].includes(cronRun.status) && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300" data-testid="daily-actions-cron-banner">
          ⚠️ รอบวิเคราะห์รายวัน {cronRun.run_date} วิเคราะห์ไม่สำเร็จ {Number(cronRun.failed) + Number(cronRun.rate_limited)} ตัว (สำเร็จ {Number(cronRun.processed)} ตัว) ตัวที่ไม่สำเร็จยังเป็นผลของรอบก่อน
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-500" role="status">กำลังโหลดผลวิเคราะห์...</p>
      ) : heldCount === 0 && !loadFailed ? (
        <p className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 text-sm text-gray-400">ยังไม่มีหุ้นในพอร์ตนี้</p>
      ) : (
        <>
          <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4" data-testid="daily-actions-summary">
            <p className="text-sm text-gray-300">
              วิเคราะห์ล่าสุด <span className="font-semibold text-white">{fmtDateTime(plan.totals.latestAnalysedAt)}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PLAN_GROUP_ORDER.filter(group => plan.totals.counts[group] > 0).map(group => (
                <span key={group} className={`rounded-full border px-3 py-1 text-xs font-semibold ${GROUP_STYLE[group]}`}>
                  {GROUP_ICON[group]} {PLAN_GROUP_LABEL[group]} {plan.totals.counts[group]} ตัว
                </span>
              ))}
            </div>
            {(plan.totals.buyUsd > 0 || plan.totals.sellUsd > 0) && (
              <p className="mt-3 text-sm text-gray-300" data-testid="daily-actions-totals">
                {plan.totals.buyUsd > 0 && <>ซื้อรวม <span className="font-semibold text-green-400">{fmtUsd(plan.totals.buyUsd)}</span></>}
                {plan.totals.buyUsd > 0 && plan.totals.sellUsd > 0 && ' · '}
                {plan.totals.sellUsd > 0 && <>ขายรวม <span className="font-semibold text-orange-400">{fmtUsd(plan.totals.sellUsd)}</span></>}
              </p>
            )}
            {plan.totals.missingNumbers > 0 && (
              <p className="mt-2 text-xs text-gray-500">มี {plan.totals.missingNumbers} ตัวที่ผลวิเคราะห์ไม่มีตัวเลขจำนวนหุ้น จึงไม่รวมในยอดข้างบน</p>
            )}
            {staleOrderCount > 0 && (
              <p className="mt-2 text-xs text-amber-300" data-testid="daily-actions-stale-totals">ยอดรวมนี้รวม {staleOrderCount} ตัวที่พอร์ตถูกแก้หลังวิเคราะห์ ตัวเลขอาจไม่ตรงกับพอร์ตตอนนี้</p>
            )}
            {hasManualBuy && (
              <p className="mt-2 text-xs text-gray-500">ผลที่วิเคราะห์เองคิดเงินซื้อแยกทีละตัว ยอดซื้อรวมอาจเกินเงินที่พร้อมใช้ โปรดเทียบกับเงินสดก่อนทำจริง</p>
            )}
          </section>

          {PLAN_GROUP_ORDER.map(group => {
            const rows = plan.rows.filter(row => row.group === group)
            if (rows.length === 0) return null
            return (
              <section key={group} className="space-y-2" data-testid={`daily-actions-group-${group}`}>
                <h2 className="text-sm font-semibold text-gray-300">{GROUP_ICON[group]} {PLAN_GROUP_LABEL[group]} ({rows.length})</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {rows.map(row => <RowCard key={row.symbol} row={row} />)}
                </div>
              </section>
            )
          })}
        </>
      )}

      <p className="text-xs text-gray-600">
        ตัวเลขคำนวณจากจำนวนหุ้นและราคา ณ ตอนวิเคราะห์ ไม่ใช่คำสั่งซื้อขาย และไม่ใช่คำแนะนำการลงทุน ตัดสินใจเองและตรวจเงินสด/ราคาปัจจุบันก่อนทำจริง ·{' '}
        <Link href="/dashboard" className="underline hover:text-gray-400">ดูรายละเอียดเต็มของแต่ละตัวที่หน้าพอร์ต</Link>
      </p>
    </div>
  )
}
