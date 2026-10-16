'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { QuickNotesSession } from '@/lib/quick-notes-session'

function buildAiPrompt(notes: string): string {
  const body = notes.trim() || '(ยังไม่ได้จดอะไรไว้ — เติมรายละเอียดตรงนี้ก่อน copy ไปสั่งงานจริง)'
  return `ช่วยดำเนินการเก็บรายละเอียดและพัฒนาฟีเจอร์เพิ่มเติมให้ระบบ "พอร์ตน้องเจน" สมบูรณ์ตามรายการนี้ครับ:
---
${body}
---
### 🛡️ กฎเหล็กในการอัปเดตโค้ด (Code Preservation Guidelines):
1. **Preserve Existing Features (ห้ามลบฟีเจอร์เดิม):**
   - โค้ดใหม่ต้องเป็นแบบ Backward Compatible ทั้งหมด
   - ห้ามตัด/ลบ Logic เดิมที่ทำเสร็จไปแล้ว (OHLCV Data, Swing High/Low, Volume Ratio, Model Badge, Earnings Calendar Check, Daily Cron Analysis, Weekly RSI, Market Status, Track Record, Fallback Latest Record, โน้ตด่วน Drawer และ Sector/Business แบบนิ่ง)
2. **Full Code Output (ห้ามละโค้ด):**
   - เมื่อแก้ไขไฟล์ใดก็ตาม ให้เขียนโค้ดเต็มสมบูรณ์ของไฟล์นั้น ห้ามใช้คอมเมนต์ประเภท \`// ... existing code ...\` เพื่อป้องกันไม่ให้เผลอลบส่วนสำคัญออก
3. **Targeted Changes Only (แก้เฉพาะจุด):**
   - ปรับแก้ไขเฉพาะไฟล์และฟังก์ชันที่เกี่ยวข้องกับโจทย์นี้เท่านั้น ห้ามรีแฟคเตอร์ (Refactor) หรือเปลี่ยนชื่อ Variable/Interface ของส่วนอื่นเกินจำเป็น`
}

export default function QuickNotesDrawer() {
  const [isOpen, setIsOpen] = useState(false)
  const [session] = useState(() => new QuickNotesSession())
  const { content, loaded, loadFailed, saveStatus } = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  const drawerId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)
  const [exported, setExported] = useState(false)

  useEffect(() => {
    void session.load()
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (session.hasUnsavedChanges()) { event.preventDefault(); event.returnValue = '' }
    }
    let navigation = 0
    const flushBeforeLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !session.hasUnsavedChanges()) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
      const destination = new URL(link.href, window.location.href)
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return
      event.preventDefault()
      const attempt = ++navigation
      void session.flush().then(() => {
        if (attempt !== navigation || !link.isConnected) return
        if (session.hasUnsavedChanges()) setIsOpen(true)
        else link.click()
      })
    }
    window.addEventListener('beforeunload', warnUnsaved)
    document.addEventListener('click', flushBeforeLink, true)
    return () => {
      navigation++
      window.removeEventListener('beforeunload', warnUnsaved)
      document.removeEventListener('click', flushBeforeLink, true)
      session.leave()
    }
  }, [session])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!isOpen || !dialog) return
    dialog.showModal()
    const trigger = triggerRef.current
    // Native modal dialog makes the background inert and traps Tab/Shift+Tab.
    const target = dialog.querySelector<HTMLElement>('textarea:not(:disabled), button')
    target?.focus()
    return () => {
      dialog.close()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [isOpen])

  function handleCopy() {
    navigator.clipboard.writeText(content)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  }

  function handleClear() {
    if (content.trim() && !window.confirm('ล้างโน้ตทั้งหมด? กู้คืนไม่ได้')) return
    session.edit('')
  }

  function handleExportPrompt() {
    navigator.clipboard.writeText(buildAiPrompt(content))
      .then(() => {
        setExported(true)
        setTimeout(() => setExported(false), 2000)
      })
      .catch(() => {})
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="เปิด โน้ตด่วน"
        aria-expanded={isOpen}
        aria-controls={drawerId}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 text-xl shadow-lg transition-all hover:scale-105 hover:bg-purple-500"
      >
        📝
      </button>

      <dialog
        id={drawerId}
        ref={dialogRef}
        onCancel={() => setIsOpen(false)}
        onClose={() => setIsOpen(false)}
        onKeyDown={event => {
          if (event.key !== 'Tab') return
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter(node => node.getClientRects().length > 0)
          const first = focusable[0], last = focusable.at(-1)
          if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
            event.preventDefault()
            ;(event.shiftKey ? last : first).focus()
          }
        }}
        onClick={event => {
          if (event.target !== event.currentTarget) return
          const box = event.currentTarget.getBoundingClientRect()
          if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) setIsOpen(false)
        }}
        className="fixed m-0 w-full max-w-none flex-col bg-gray-900 shadow-2xl backdrop:bg-black/50 open:flex
          inset-x-0 bottom-0 top-auto h-[65vh] max-h-screen rounded-t-2xl border border-gray-800
          sm:inset-y-0 sm:right-0 sm:left-auto sm:h-dvh sm:max-h-none sm:w-[360px] sm:rounded-none sm:rounded-l-2xl"
        aria-modal={isOpen ? true : undefined}
        aria-label="โน้ตด่วน"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-3">
          <span className="text-sm font-semibold text-gray-200">📝 โน้ตด่วน</span>
          <button type="button" onClick={() => setIsOpen(false)} className="text-sm text-gray-400 hover:text-white" aria-label="ปิด โน้ตด่วน">✕</button>
        </div>

        <div className="min-h-0 flex-1 p-3">
          {loadFailed ? (
            <div className="flex h-full flex-col items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-center">
              <p className="text-sm font-medium text-red-400">โหลดโน้ตไม่สำเร็จ</p>
              <p className="mt-1 text-xs text-gray-400">ระบบหยุด Auto-save ไว้เพื่อไม่ให้ข้อความว่างทับโน้ตเดิม</p>
              <button type="button" onClick={() => void session.load()} className="mt-3 rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">ลองโหลดใหม่</button>
            </div>
          ) : (
            <textarea
              value={content}
              onChange={event => session.edit(event.target.value)}
              aria-label="ข้อความโน้ตด่วน"
              maxLength={50_000}
              disabled={!loaded}
              placeholder={loaded ? 'จดไอเดีย ฟีเจอร์ที่อยากทำเพิ่ม...' : 'กำลังโหลดโน้ต...'}
              className="h-full w-full resize-none rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-sm text-gray-200 placeholder-gray-400 focus:border-purple-500/50 focus:outline-none disabled:opacity-50"
            />
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-gray-800 px-4 py-2.5">
          <button type="button" onClick={handleExportPrompt} disabled={!loaded} className="w-full rounded border border-purple-500/30 bg-purple-600/20 px-2.5 py-1.5 text-xs font-medium text-purple-800 dark:text-purple-300 transition-colors hover:bg-purple-600/30 disabled:opacity-40">
            {exported ? '✓ คัดลอก Prompt แล้ว — พร้อมนำไปใช้กับ AI' : '📤 คัดลอก Prompt สำหรับ AI'}
          </button>
          <div className="flex items-center justify-between">
            <span role="status" className={`text-xs ${saveStatus === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
              {saveStatus === 'saving' ? '⏳ กำลังบันทึก...' : saveStatus === 'saved' ? '✓ บันทึกอัตโนมัติแล้ว' : saveStatus === 'error' ? '⚠️ บันทึกไม่สำเร็จ — คัดลอกข้อความไว้ แล้วเปิดหน้าใหม่ก่อนลองอีกครั้ง' : ''}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleClear} disabled={!loaded} className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-400 transition-colors hover:bg-red-900/40 hover:text-red-300 disabled:opacity-40">🗑️ ล้าง</button>
              <button type="button" onClick={handleCopy} disabled={!loaded} className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-40">
                {copied ? '✓ คัดลอกแล้ว' : '📋 คัดลอก'}
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  )
}
