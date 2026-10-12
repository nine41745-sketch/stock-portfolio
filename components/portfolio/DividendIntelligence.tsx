'use client'

import { useEffect, useState } from 'react'
import type { summarizeDividends } from '@/lib/dividend-intelligence'

type Summary = ReturnType<typeof summarizeDividends> & { portfolio: { id: string; name: string }; methodology: string; as_of: string }
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
function defaultRange() {
  const to = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return { from: `${to.slice(0, 4)}-01-01`, to }
}

export default function DividendIntelligence() {
  const [draft, setDraft] = useState(defaultRange)
  const [range, setRange] = useState(defaultRange)
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/dividend-intelligence?${new URLSearchParams(range)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'โหลดปันผลไม่สำเร็จ')
        if (!controller.signal.aborted) setData(payload)
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'โหลดไม่สำเร็จ') })
    return () => controller.abort()
  }, [range])
  return <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 md:p-6">
    <h2 className="font-bold text-white">Dividend Intelligence — ปันผลที่บันทึกจริง</h2>
    <p className="mt-1 text-xs text-gray-400">อ่านจาก Transaction Ledger ของพอร์ตนี้ · ไม่มีข้อมูลประมาณการหรือ Provider ใหม่</p>
    <form onSubmit={event => { event.preventDefault(); setData(null); setError(null); setRange({ ...draft }) }} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="text-xs text-gray-400">ตั้งแต่<input required type="date" value={draft.from} onChange={event => setDraft(p => ({ ...p, from: event.target.value }))} className="mt-1 block rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" /></label>
      <label className="text-xs text-gray-400">ถึง<input required type="date" min={draft.from} value={draft.to} onChange={event => setDraft(p => ({ ...p, to: event.target.value }))} className="mt-1 block rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" /></label>
      <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">แสดงช่วงเวลา</button>
    </form>
    {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : !data ? <p className="mt-3 text-sm text-gray-500">กำลังอ่านปันผลจาก Ledger...</p> : <div className="mt-4 space-y-3">
      <p className="text-sm text-gray-300">พอร์ต {data.portfolio.name} · {data.from} ถึง {data.to} · {data.count} รายการ · รวม <strong className="text-green-300">{money(data.total)}</strong></p>
      {data.invalid_rows > 0 && <p role="alert" className="text-xs text-yellow-200">มี {data.invalid_rows} รายการที่อ่านไม่ได้ ยอดสรุปนี้จึงไม่ครบ กรุณาตรวจ Ledger</p>}
      {data.count === 0 && <p className="text-sm text-gray-400">ไม่มีรายการ DIVIDEND ที่อ่านได้ในช่วงนี้ ไม่ได้หมายความว่า broker ไม่เคยจ่ายปันผล</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <div><h3 className="text-sm text-gray-400">ตามหุ้น</h3><table className="mt-2 w-full text-left text-sm text-gray-300"><thead><tr><th className="p-2">หุ้น</th><th className="p-2">รายการ</th><th className="p-2">ยอด USD</th></tr></thead><tbody>{data.by_symbol.map(row => <tr key={row.symbol} className="border-t border-gray-800"><td className="p-2">{row.symbol}</td><td className="p-2">{row.count}</td><td className="p-2">{money(row.amount)}</td></tr>)}</tbody></table></div>
        <div><h3 className="text-sm text-gray-400">ตามเดือน</h3><table className="mt-2 w-full text-left text-sm text-gray-300"><thead><tr><th className="p-2">เดือน</th><th className="p-2">รายการ</th><th className="p-2">ยอด USD</th></tr></thead><tbody>{data.by_month.map(row => <tr key={row.month} className="border-t border-gray-800"><td className="p-2">{row.month}</td><td className="p-2">{row.count}</td><td className="p-2">{money(row.amount)}</td></tr>)}</tbody></table></div>
      </div>
      <p className="text-xs text-gray-500">{data.methodology} · อ่านข้อมูล {new Date(data.as_of).toLocaleString('th-TH')}</p>
    </div>}
  </section>
}
