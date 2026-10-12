'use client'

import { useEffect, useState } from 'react'
import type { DcaPlan } from '@/lib/smart-dca'

interface Snapshot {
  portfolio: { id: string; name: string }
  dime_balance: number | null
  as_of: string
  quote_policy: string
}
const money = (n: number | null) => n === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export default function SmartDcaPlanner() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [plan, setPlan] = useState<DcaPlan | null>(null)
  const [inputs, setInputs] = useState({ budget: '100', cash_reserve: '0', max_position_pct: '30', fee_per_order: '0' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/smart-dca', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'โหลด DCA ไม่สำเร็จ')
        if (!controller.signal.aborted) setSnapshot(payload)
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'โหลดไม่สำเร็จ') })
    return () => controller.abort()
  }, [reload])

  async function calculate(event: React.FormEvent) {
    event.preventDefault()
    if (!snapshot || busy) return
    setBusy(true); setError(null); setPlan(null)
    try {
      const response = await fetch('/api/smart-dca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...inputs, portfolio_id: snapshot.portfolio.id }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'คำนวณไม่สำเร็จ')
      setSnapshot(payload); setPlan(payload.plan)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'คำนวณไม่สำเร็จ') }
    finally { setBusy(false) }
  }

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 md:p-6">
      <h2 className="font-bold text-white">Smart DCA — วางแผนจาก DIME</h2>
      <p className="mt-1 text-xs text-gray-400">ใช้ Target Allocation ที่บันทึกแล้ว · ไม่สร้างธุรกรรมหรือซื้อหุ้นอัตโนมัติ · ไม่มีการเพิ่มเงินใหม่เข้าพอร์ต</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-300">
        <span>{snapshot ? `พอร์ต ${snapshot.portfolio.name} · DIME ${money(snapshot.dime_balance)}` : 'กำลังอ่านข้อมูลพอร์ต...'}</span>
        <button type="button" disabled={busy} onClick={() => { setSnapshot(null); setPlan(null); setError(null); setReload(n => n + 1) }} className="rounded-lg border border-gray-700 px-3 py-2 text-xs disabled:opacity-50">โหลดข้อมูลใหม่</button>
      </div>
      <form onSubmit={calculate} className="mt-4 flex flex-wrap items-end gap-3">
        {([
          ['budget', 'งบลงทุน USD', '0.01', '0', undefined],
          ['cash_reserve', 'Cash Reserve USD', '0.01', '0', undefined],
          ['max_position_pct', 'เพดานรายหุ้น %', '0.1', '0.1', '30'],
          ['fee_per_order', 'ค่าธรรมเนียมต่อรายการ USD', '0.01', '0', undefined],
        ] as const).map(([key, label, step, min, max]) => (
          <label key={key} className="text-xs text-gray-400">{label}
            <input required disabled={busy} type="number" step={step} min={min} max={max ?? '1000000000'} value={inputs[key]} onChange={event => { setInputs(p => ({ ...p, [key]: event.target.value })); setPlan(null) }} className="mt-1 block w-40 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" />
          </label>
        ))}
        <button disabled={!snapshot || busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'กำลังคำนวณ...' : 'คำนวณแผน'}</button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      {snapshot && <p className="mt-3 text-xs text-gray-500">อ่านข้อมูล {new Date(snapshot.as_of).toLocaleString('th-TH')} · {snapshot.quote_policy}</p>}
      {plan && <div className="mt-4 space-y-3">
        <p className="text-sm text-gray-300">มูลค่า Holdings + DIME {money(plan.portfolio_value)} · Reserve ที่ใช้ {money(plan.effective_reserve)} · งบที่ใช้ได้ {money(plan.available_budget)}</p>
        <p className="text-xs text-gray-400">Reserve = ค่าที่กรอกหรือ DIME Target แล้วแต่ค่าใดสูงกว่า · จำกัด gap ตาม Target/เพดานรายหุ้นและเฉลี่ยงบตาม gap · ค่าธรรมเนียมลดมูลค่าพอร์ต ไม่เพิ่มเงินจากธนาคาร</p>
        {plan.rows.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm text-gray-300">
          <thead className="text-left text-xs text-gray-500"><tr><th className="p-2">หุ้น</th><th className="p-2">ราคาอ้างอิง</th><th className="p-2">จำนวนหุ้นประมาณ</th><th className="p-2">งบ/ค่าธรรมเนียม</th><th className="p-2">สัดส่วนหลังซื้อ</th><th className="p-2">เหตุผล</th></tr></thead>
          <tbody>{plan.rows.map(row => <tr key={row.symbol} className="border-t border-gray-800"><td className="p-2 font-semibold">{row.symbol}</td><td className="p-2">{money(row.price)}</td><td className="p-2">{row.shares.toFixed(6)}</td><td className="p-2">{money(row.amount)} / {money(row.fee)}</td><td className="p-2">{row.projected_pct.toFixed(2)}%</td><td className="p-2 text-xs">{row.reason}</td></tr>)}</tbody>
        </table></div>}
        <p className="text-sm text-gray-300">ลงทุน {money(plan.invested)} · ค่าธรรมเนียม {money(plan.fees)} · DIME คงเหลือ {money(plan.remaining_dime)}</p>
        <ul className="space-y-1 text-xs text-yellow-200">{plan.warnings.map(w => <li key={w}>{w}</li>)}</ul>
      </div>}
    </section>
  )
}
