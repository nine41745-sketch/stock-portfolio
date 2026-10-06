'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  calculateAllocationSnapshot,
  calculateNewMoneyPlan,
  type AllocationTargetInput,
} from '@/lib/allocation'

interface PositionInput {
  symbol: string
  market_value: number
}

interface TargetResponse {
  targets: Array<{ asset_key: string; target_pct: number; updated_at?: string | null }>
  migration_required?: boolean
  migration?: string
  error?: string
}

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(2)}%`
}

function statusLabel(status: string): string {
  if (status === 'UNDER') return 'Underweight'
  if (status === 'OVER') return 'Overweight'
  if (status === 'ON_TARGET') return 'ใกล้เป้า'
  return 'ยังไม่ตั้ง'
}

function statusClass(status: string): string {
  if (status === 'UNDER') return 'text-green-300'
  if (status === 'OVER') return 'text-red-300'
  if (status === 'ON_TARGET') return 'text-blue-300'
  return 'text-gray-500'
}

export default function AllocationPlanner({
  positions,
  dimeBalance,
}: {
  positions: PositionInput[]
  dimeBalance: number
}) {
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [savedTargets, setSavedTargets] = useState<AllocationTargetInput[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [migrationRequired, setMigrationRequired] = useState(false)
  const [migrationFile, setMigrationFile] = useState<string | null>(null)
  const [newSymbol, setNewSymbol] = useState('')
  const [newMoney, setNewMoney] = useState('')

  const currentAssets = useMemo(() => [
    ...positions.map(position => ({ asset_key: position.symbol, current_value: position.market_value })),
    { asset_key: 'DIME', current_value: Math.max(0, Number(dimeBalance) || 0) },
  ], [positions, dimeBalance])

  const allKeys = useMemo(() => Array.from(new Set([
    ...currentAssets.map(item => item.asset_key),
    ...Object.keys(targets),
  ])).sort((a, b) => {
    if (a === 'DIME') return 1
    if (b === 'DIME') return -1
    return a.localeCompare(b)
  }), [currentAssets, targets])

  const draftTargets = useMemo<AllocationTargetInput[]>(() => allKeys.map(assetKey => ({
    asset_key: assetKey,
    target_pct: Number(targets[assetKey] || 0),
  })), [allKeys, targets])

  const draftSnapshot = useMemo(
    () => calculateAllocationSnapshot(currentAssets, draftTargets),
    [currentAssets, draftTargets],
  )

  const savedSnapshot = useMemo(
    () => calculateAllocationSnapshot(currentAssets, savedTargets),
    [currentAssets, savedTargets],
  )

  const newMoneyValue = Number(newMoney)
  const newMoneyPlan = useMemo(
    () => calculateNewMoneyPlan(savedSnapshot, newMoneyValue),
    [savedSnapshot, newMoneyValue],
  )

  async function loadTargets() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/allocation-targets', { cache: 'no-store' })
      const payload = await response.json() as TargetResponse
      if (!response.ok) {
        if (payload.migration_required) {
          setMigrationRequired(true)
          setMigrationFile(payload.migration ?? 'supabase/migration_allocation_targets_v1.31.0.sql')
          setSavedTargets([])
          setTargets({})
          return
        }
        throw new Error(payload.error || 'โหลด Target Allocation ไม่สำเร็จ')
      }

      const normalized = payload.targets.map(item => ({
        asset_key: item.asset_key.toUpperCase(),
        target_pct: Number(item.target_pct),
      }))
      setMigrationRequired(false)
      setSavedTargets(normalized)
      setTargets(Object.fromEntries(normalized.map(item => [item.asset_key, String(item.target_pct)])))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'โหลด Target Allocation ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTargets()
  }, [])

  function useCurrentWeights() {
    const currentOnly = calculateAllocationSnapshot(currentAssets, [])
    const next: Record<string, string> = {}
    let running = 0

    currentOnly.rows.forEach((row, index) => {
      let value = row.current_pct ?? 0
      if (index === currentOnly.rows.length - 1) value = Math.max(0, 100 - running)
      const rounded = Math.round(value * 100) / 100
      running = Math.round((running + rounded) * 100) / 100
      next[row.asset_key] = String(rounded)
    })
    setTargets(next)
    setMessage('คัดลอกสัดส่วนปัจจุบันมาเป็น Target แล้ว — กดบันทึกเมื่อพร้อม')
  }

  function addSymbol() {
    const symbol = newSymbol.trim().toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol) || symbol === 'DIME') {
      setError('Symbol ที่เพิ่มไม่ถูกต้อง')
      return
    }
    setTargets(current => ({ ...current, [symbol]: current[symbol] ?? '0' }))
    setNewSymbol('')
    setError(null)
  }

  async function saveTargets() {
    if (!draftSnapshot.targets_valid) {
      setError(`Target รวมต้องเท่ากับ 100% (ตอนนี้ ${draftSnapshot.target_total_pct.toFixed(2)}%)`)
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/allocation-targets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: draftTargets }),
      })
      const payload = await response.json() as TargetResponse & { ok?: boolean }
      if (!response.ok) {
        if (payload.migration_required) {
          setMigrationRequired(true)
          setMigrationFile(payload.migration ?? 'supabase/migration_allocation_targets_v1.31.0.sql')
        }
        throw new Error(payload.error || 'บันทึก Target Allocation ไม่สำเร็จ')
      }

      setSavedTargets(draftTargets)
      setMessage('บันทึก Target Allocation แล้ว')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'บันทึก Target Allocation ไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="font-bold text-white">🎯 Target Allocation + Rebalance</h2>
          <p className="mt-1 text-xs text-gray-400">ฐานคำนวณ = มูลค่าหุ้นปัจจุบัน + เงินสดใน DIME เท่านั้น · เงินในธนาคารไม่นำมารวมเพื่อป้องกัน double-counting</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={useCurrentWeights} disabled={loading || migrationRequired}
            className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-40">
            ใช้สัดส่วนปัจจุบันเป็น Target
          </button>
          <button type="button" onClick={saveTargets} disabled={saving || loading || migrationRequired || !draftSnapshot.targets_valid}
            className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? 'กำลังบันทึก...' : 'บันทึก Target'}
          </button>
        </div>
      </div>

      {migrationRequired && (
        <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
          ต้อง Apply Migration ก่อนจึงจะบันทึก Target ได้: <span className="font-mono">{migrationFile}</span>
        </div>
      )}
      {error && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">⚠️ {error}</div>}
      {message && <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-200">✓ {message}</div>}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-400">เพิ่มหุ้นใน Target
          <input value={newSymbol} onChange={event => setNewSymbol(event.target.value.toUpperCase())}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addSymbol() } }}
            placeholder="เช่น NVDA"
            className="mt-1 block w-40 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" />
        </label>
        <button type="button" onClick={addSymbol} className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800">+ เพิ่ม Symbol</button>
        <div className="ml-auto rounded-lg bg-gray-950/60 px-3 py-2 text-xs">
          <span className="text-gray-500">Target รวม </span>
          <span className={draftSnapshot.targets_valid ? 'font-bold text-green-300' : 'font-bold text-yellow-300'}>{draftSnapshot.target_total_pct.toFixed(2)}%</span>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="border-b border-gray-800 text-left text-xs text-gray-500">
            <tr>
              <th className="px-2 py-2">Asset</th>
              <th className="px-2 py-2 text-right">มูลค่าปัจจุบัน</th>
              <th className="px-2 py-2 text-right">Current %</th>
              <th className="px-2 py-2 text-right">Target %</th>
              <th className="px-2 py-2 text-right">Gap $</th>
              <th className="px-2 py-2 text-right">Gap %</th>
              <th className="px-2 py-2">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {draftSnapshot.rows.map(row => (
              <tr key={row.asset_key} className="border-b border-gray-900 text-gray-300">
                <td className="px-2 py-3 font-bold text-white">{row.asset_key === 'DIME' ? '💵 DIME Cash' : row.asset_key}</td>
                <td className="px-2 py-3 text-right">{money(row.current_value)}</td>
                <td className="px-2 py-3 text-right">{pct(row.current_pct)}</td>
                <td className="px-2 py-3 text-right">
                  <input type="number" min="0" max="100" step="0.01"
                    value={targets[row.asset_key] ?? '0'}
                    onChange={event => setTargets(current => ({ ...current, [row.asset_key]: event.target.value }))}
                    className="w-24 rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-right text-sm text-white" />
                </td>
                <td className={`px-2 py-3 text-right font-semibold ${(row.gap_amount ?? 0) > 0 ? 'text-green-300' : (row.gap_amount ?? 0) < 0 ? 'text-red-300' : 'text-gray-400'}`}>
                  {row.gap_amount === null ? '—' : `${row.gap_amount >= 0 ? '+' : ''}${money(row.gap_amount)}`}
                </td>
                <td className="px-2 py-3 text-right">{row.gap_pct === null ? '—' : `${row.gap_pct >= 0 ? '+' : ''}${row.gap_pct.toFixed(2)}%`}</td>
                <td className={`px-2 py-3 text-xs font-semibold ${statusClass(row.status)}`}>{statusLabel(row.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-4">
          <h3 className="font-semibold text-white">⚖️ Full Rebalance Gap</h3>
          <p className="mt-1 text-xs text-gray-500">ถ้าจะกลับสู่ Target วันนี้ จำนวนบวก = ควรเพิ่ม, จำนวนลบ = ส่วนที่เกินเป้า — เป็นข้อมูลเท่านั้น ไม่สั่งซื้อ/ขาย</p>
          <div className="mt-3 space-y-2">
            {savedSnapshot.targets_valid ? savedSnapshot.rows.map(row => (
              <div key={row.asset_key} className="flex items-center justify-between rounded-lg bg-gray-900/70 px-3 py-2 text-xs">
                <span className="font-semibold text-gray-300">{row.asset_key}</span>
                <span className={(row.gap_amount ?? 0) > 0 ? 'text-green-300' : (row.gap_amount ?? 0) < 0 ? 'text-red-300' : 'text-gray-400'}>
                  {row.gap_amount === null ? '—' : `${row.gap_amount >= 0 ? 'เพิ่ม ' : 'เกิน '}${money(Math.abs(row.gap_amount))}`}
                </span>
              </div>
            )) : <p className="py-4 text-center text-xs text-gray-600">บันทึก Target รวม 100% ก่อน</p>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-4">
          <h3 className="font-semibold text-white">💰 เติมเงินใหม่โดยไม่ขาย</h3>
          <p className="mt-1 text-xs text-gray-500">กระจายเงินใหม่ไปยังสินทรัพย์ที่ Underweight ตาม deficit เพื่อเข้าใกล้ Target โดยไม่บังคับขายตัว Overweight</p>
          <label className="mt-3 block text-xs text-gray-400">เงินใหม่ (USD)
            <input type="number" min="0" step="0.01" value={newMoney}
              onChange={event => setNewMoney(event.target.value)}
              placeholder="เช่น 500"
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white" />
          </label>
          <div className="mt-3 space-y-2">
            {newMoneyValue > 0 && savedSnapshot.targets_valid && newMoneyPlan.length === 0 && (
              <p className="text-xs text-gray-600">ไม่มี Underweight ที่ต้องเติมตาม Target ปัจจุบัน</p>
            )}
            {newMoneyPlan.map(item => (
              <div key={item.asset_key} className="flex items-center justify-between rounded-lg border border-green-500/15 bg-green-500/5 px-3 py-2 text-xs">
                <div>
                  <p className="font-semibold text-white">{item.asset_key}</p>
                  <p className="text-gray-500">หลังเติมประมาณ {pct(item.projected_pct)}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-green-300">+{money(item.amount)}</p>
                  <p className="text-gray-500">{pct(item.pct_of_new_money)} ของเงินใหม่</p>
                </div>
              </div>
            ))}
            {(!savedSnapshot.targets_valid || newMoneyValue <= 0) && (
              <p className="py-4 text-center text-xs text-gray-600">บันทึก Target และกรอกเงินใหม่เพื่อดูแผน</p>
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
        Read-only Rebalance Plan: หน้านี้ไม่สร้าง BUY/SELL และไม่แก้ Holdings/DIME อัตโนมัติ การซื้อขายจริงยังต้องทำผ่าน Real Trade Auto Sync หรือบันทึกธุรกรรมด้วยตัวเอง
      </p>
    </section>
  )
}
