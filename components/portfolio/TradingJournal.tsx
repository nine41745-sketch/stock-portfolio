'use client'

import { useEffect, useMemo, useState } from 'react'

type JournalTransaction = {
  id: string
  transaction_type: 'BUY' | 'SELL' | 'OPENING_POSITION' | 'DIVIDEND' | 'DEPOSIT' | 'WITHDRAW'
  symbol: string | null
  shares: number | null
  price: number | null
  fee: number | null
  trade_date: string
}

type JournalDraft = {
  rationale: string
  plan: string
  review: string
  lessons: string
}

type JournalResponse = {
  items?: unknown
  portfolio?: { id: string; name: string } | null
  migration_required?: boolean
  error?: string
}

const EMPTY_DRAFT: JournalDraft = { rationale: '', plan: '', review: '', lessons: '' }
const TYPE_LABEL: Record<JournalTransaction['transaction_type'], string> = {
  BUY: 'ซื้อ', SELL: 'ขาย', OPENING_POSITION: 'ยอดตั้งต้น',
  DIVIDEND: 'ปันผล', DEPOSIT: 'ฝากเงิน', WITHDRAW: 'ถอนเงิน',
}

function hasContent(drafts: Record<string, JournalDraft>): boolean {
  return Object.values(drafts).some(draft => Object.values(draft).some(value => value.trim().length > 0))
}

function isJournalTransaction(value: unknown): value is JournalTransaction {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<JournalTransaction>
  return typeof item.id === 'string'
    && typeof item.trade_date === 'string'
    && ['BUY', 'SELL', 'OPENING_POSITION', 'DIVIDEND', 'DEPOSIT', 'WITHDRAW'].includes(String(item.transaction_type))
    && (item.symbol === null || typeof item.symbol === 'string')
    && (item.shares === null || typeof item.shares === 'number' && Number.isFinite(item.shares))
    && (item.price === null || typeof item.price === 'number' && Number.isFinite(item.price))
    && (item.fee === null || typeof item.fee === 'number' && Number.isFinite(item.fee))
}

export default function TradingJournal({
  expectedPortfolioId,
  portfolioName,
}: {
  expectedPortfolioId: string | null
  portfolioName: string
}) {
  const [items, setItems] = useState<JournalTransaction[]>([])
  const [drafts, setDrafts] = useState<Record<string, JournalDraft>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [migrationRequired, setMigrationRequired] = useState(false)
  const [partialRows, setPartialRows] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const dirty = useMemo(() => hasContent(drafts), [drafts])

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/transactions', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as JournalResponse
        if (!response.ok) {
          setMigrationRequired(Boolean(body.migration_required))
          throw new Error(body.error || 'โหลด Journal ไม่สำเร็จ')
        }
        if ((body.portfolio?.id ?? null) !== expectedPortfolioId) {
          throw new Error('พอร์ตที่ตอบกลับไม่ตรงกับพอร์ตที่เลือก จึงซ่อนข้อมูลไว้เพื่อความปลอดภัย')
        }
        if (!Array.isArray(body.items)) throw new Error('ข้อมูล Ledger ที่ได้รับไม่ครบ จึงยังไม่แสดง Journal')
        return body
      })
      .then(body => {
        setMigrationRequired(false)
        const rows = body.items as unknown[]
        const validRows = rows.filter(isJournalTransaction)
        setPartialRows(rows.length - validRows.length)
        setItems(validRows)
      })
      .catch(reason => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : 'โหลด Journal ไม่สำเร็จ')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [attempt, expectedPortfolioId])

  useEffect(() => {
    if (!dirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const confirmBeforeInternalNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const anchor = event.target.closest('a[href]') as HTMLAnchorElement | null
      const button = event.target.closest('button') as HTMLButtonElement | null
      const navigatesByButton = Boolean(button && (
        button.title.startsWith('ล็อกพอร์ต')
        || button.textContent?.includes('ออกจากระบบ')
        || button.textContent?.includes('เพิ่มพอร์ต')
      ))
      if ((!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) && !navigatesByButton) return
      if (anchor && anchor.target !== '_blank' && !anchor.hasAttribute('download')) {
        const destination = new URL(anchor.href, window.location.href)
        if (destination.origin !== window.location.origin
          || destination.pathname === window.location.pathname && destination.search === window.location.search) return
      }
      if (!window.confirm('Journal นี้เป็นแบบร่างในหน่วยความจำ หากออกจากหน้านี้ เนื้อหาจะหาย ต้องการออกและทิ้งแบบร่างหรือไม่?')) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    const confirmBeforePortfolioSwitch = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLSelectElement) || target.getAttribute('aria-label') !== 'เลือกพอร์ต'
        || target.value === expectedPortfolioId) return
      if (!window.confirm('Journal นี้เป็นแบบร่างในหน่วยความจำ หากเปลี่ยนพอร์ต เนื้อหาจะหาย ต้องการเปลี่ยนและทิ้งแบบร่างหรือไม่?')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        target.value = expectedPortfolioId ?? ''
      }
    }
    const guardedHref = window.location.href
    const guardedHistoryState = window.history.state
    const confirmBeforeHistoryNavigation = (event: PopStateEvent) => {
      if (window.confirm('Journal นี้เป็นแบบร่างในหน่วยความจำ หากออกจากหน้านี้ เนื้อหาจะหาย ต้องการออกและทิ้งแบบร่างหรือไม่?')) return
      event.stopImmediatePropagation()
      window.history.pushState(guardedHistoryState, '', guardedHref)
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    document.addEventListener('click', confirmBeforeInternalNavigation, true)
    document.addEventListener('change', confirmBeforePortfolioSwitch, true)
    window.addEventListener('popstate', confirmBeforeHistoryNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload)
      document.removeEventListener('click', confirmBeforeInternalNavigation, true)
      document.removeEventListener('change', confirmBeforePortfolioSwitch, true)
      window.removeEventListener('popstate', confirmBeforeHistoryNavigation, true)
    }
  }, [dirty, expectedPortfolioId])

  const journalItems = useMemo(() => items
    .filter(item => ['BUY', 'SELL', 'OPENING_POSITION'].includes(item.transaction_type) && item.symbol)
    .slice()
    .sort((a, b) => b.trade_date.localeCompare(a.trade_date) || b.id.localeCompare(a.id)), [items])

  function updateDraft(id: string, key: keyof JournalDraft, value: string) {
    setDrafts(current => ({
      ...current,
      [id]: { ...(current[id] ?? EMPTY_DRAFT), [key]: value },
    }))
  }

  function retryLoad() {
    setLoading(true)
    setError(null)
    setItems([])
    setPartialRows(0)
    setDrafts({})
    setSelectedId(null)
    setMigrationRequired(false)
    setAttempt(value => value + 1)
  }

  return (
    <section aria-labelledby="trading-journal-title" className="rounded-xl border border-gray-800 bg-gray-900 p-4 md:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="trading-journal-title" className="text-lg font-semibold text-white">📔 Trading Journal</h2>
          <p className="mt-1 text-sm text-gray-400">ประวัติและบันทึกผูกกับธุรกรรมของพอร์ต {portfolioName} โดยไม่แก้ข้อเท็จจริงใน Ledger</p>
        </div>
        <span className="w-fit rounded-full border border-yellow-500/30 bg-yellow-500/15 px-2.5 py-1 text-xs font-semibold text-yellow-400">Draft-only · อยู่ในหน่วยความจำ</span>
      </div>

      <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/15 p-3 text-sm text-yellow-400" role="note">
        ยังไม่มีที่เก็บ Journal ที่ปลอดภัยในระบบปัจจุบัน แบบร่างนี้ไม่บันทึกข้ามอุปกรณ์หรือหลังปิด/รีโหลดหน้า และจะเตือนก่อนออกจากหน้าเมื่อมีข้อความ
      </div>

      {migrationRequired && <p className="mt-4 rounded-lg border border-yellow-500/30 p-3 text-sm text-yellow-400">Transaction Ledger ยังไม่พร้อม จึงไม่สามารถแสดงรายการที่เชื่อมกับ Journal ได้</p>}
      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/15 p-3 text-sm text-red-400" role="alert">
          <p>{error}</p>
          <button type="button" onClick={retryLoad} className="mt-2 min-h-9 rounded px-2 underline focus:outline-none focus:ring-2 focus:ring-blue-500">ลองโหลดอีกครั้ง</button>
        </div>
      )}
      {partialRows > 0 && !error && <p className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/15 p-3 text-sm text-yellow-400" role="status">ซ่อนข้อมูล {partialRows} รายการที่ไม่ครบหรือไม่ถูกต้อง เพื่อไม่ให้แสดง Journal จากข้อมูลที่ตรวจสอบไม่ได้</p>}

      {loading ? (
        <p className="py-8 text-center text-sm text-gray-400" role="status">กำลังโหลดประวัติพอร์ต…</p>
      ) : !error && journalItems.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">ยังไม่มี BUY, SELL หรือยอดหุ้นตั้งต้นสำหรับทำบันทึก</p>
      ) : !error && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(16rem,0.85fr)_minmax(0,1.15fr)]">
          <ul aria-label="ประวัติธุรกรรมสำหรับ Journal" className="max-h-[34rem] space-y-2 overflow-y-auto">
            {journalItems.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={selectedId === item.id}
                  className={`min-h-11 w-full rounded-lg border p-3 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${selectedId === item.id ? 'border-blue-500 bg-blue-500/15' : 'border-gray-800 bg-gray-950/50 hover:bg-gray-800'}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{item.symbol} · {TYPE_LABEL[item.transaction_type]}</span>
                    <span className="text-xs text-gray-400">{item.trade_date}</span>
                  </span>
                  <span className="mt-1 block text-xs text-gray-400">{item.shares ?? '—'} หุ้น · ราคา {item.price ?? '—'} USD · Fee {item.fee ?? 0} USD</span>
                  {drafts[item.id] && Object.values(drafts[item.id]).some(value => value.trim()) && <span className="mt-1 block text-xs font-semibold text-yellow-400">มีแบบร่างในหน่วยความจำ</span>}
                </button>
              </li>
            ))}
          </ul>

          {selectedId && journalItems.some(item => item.id === selectedId) ? (
            <JournalEditor item={journalItems.find(item => item.id === selectedId)!} draft={drafts[selectedId] ?? EMPTY_DRAFT} onChange={(key, value) => updateDraft(selectedId, key, value)} />
          ) : (
            <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-gray-700 p-5 text-center text-sm text-gray-400">เลือกธุรกรรมเพื่อเขียนเหตุผล แผน การทบทวน และบทเรียน</div>
          )}
        </div>
      )}
    </section>
  )
}

function JournalEditor({
  item,
  draft,
  onChange,
}: {
  item: JournalTransaction
  draft: JournalDraft
  onChange: (key: keyof JournalDraft, value: string) => void
}) {
  const fields: Array<{ key: keyof JournalDraft; label: string }> = [
    { key: 'rationale', label: 'เหตุผลการเข้าเทรด' },
    { key: 'plan', label: 'แผนการเทรด' },
    { key: 'review', label: 'ทบทวนการดำเนินการ' },
    { key: 'lessons', label: 'บทเรียนที่ได้รับ' },
  ]
  const title = `${item.symbol} ${TYPE_LABEL[item.transaction_type]} ${item.trade_date}`

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
      <h3 className="font-semibold text-white">บริบท Ledger: {title}</h3>
      <p className="mt-1 text-xs text-gray-400">{item.shares ?? '—'} หุ้น · {item.price ?? '—'} USD/หุ้น · ค่าธรรมเนียม {item.fee ?? 0} USD</p>
      <div className="mt-4 space-y-3">
        {fields.map(field => {
          const id = `journal-${item.id}-${field.key}`
          return (
            <div key={field.key}>
              <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-300">{field.label}</label>
              <textarea
                id={id}
                value={draft[field.key]}
                onChange={event => onChange(field.key, event.target.value)}
                maxLength={2000}
                rows={3}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-describedby={`${id}-count`}
              />
              <p id={`${id}-count`} className="mt-1 text-right text-xs text-gray-400">{draft[field.key].length}/2000</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
