'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

async function requireOk(response: Response, fallback: string): Promise<Response> {
  if (response.ok) return response
  let message = fallback
  try {
    const payload = await response.clone().json() as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) message = payload.error
  } catch {
    // use fallback
  }
  throw new Error(message)
}

function buildAiPrompt(notes: string): string {
  const body = notes.trim() || '(ยังไม่ได้จดอะไรไว้ — เติมรายละเอียดตรงนี้ก่อน copy ไปสั่งงานจริง)'
  return `ช่วยดำเนินการเก็บรายละเอียดและพัฒนาฟีเจอร์เพิ่มเติมให้ระบบ "พอร์ตน้องเจน" สมบูรณ์ตามรายการนี้ครับ:
---
${body}
---
### 🛡️ กฎเหล็กในการอัปเดตโค้ด (Code Preservation Guidelines):
1. **Preserve Existing Features (ห้ามลบฟีเจอร์เดิม):**
   - โค้ดใหม่ต้องเป็นแบบ Backward Compatible ทั้งหมด
   - ห้ามตัด/ลบ Logic เดิมที่ทำเสร็จไปแล้ว (OHLCV Data, Swing High/Low, Volume Ratio, Model Badge, Earnings Calendar Check, Daily Cron Analysis, Weekly RSI, Market Status, Track Record, Fallback Latest Record, Quick Notes Drawer และ Sector/Business แบบนิ่ง)
2. **Full Code Output (ห้ามละโค้ด):**
   - เมื่อแก้ไขไฟล์ใดก็ตาม ให้เขียนโค้ดเต็มสมบูรณ์ของไฟล์นั้น ห้ามใช้คอมเมนต์ประเภท \`// ... existing code ...\` เพื่อป้องกันไม่ให้เผลอลบส่วนสำคัญออก
3. **Targeted Changes Only (แก้เฉพาะจุด):**
   - ปรับแก้ไขเฉพาะไฟล์และฟังก์ชันที่เกี่ยวข้องกับโจทย์นี้เท่านั้น ห้ามรีแฟคเตอร์ (Refactor) หรือเปลี่ยนชื่อ Variable/Interface ของส่วนอื่นเกินจำเป็น`
}

export default function QuickNotesDrawer() {
  const pathname = usePathname()
  const suppressedByLegacyDashboard = pathname === '/dashboard'
  const [isOpen, setIsOpen] = useState(false)
  const [content, setContent] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [copied, setCopied] = useState(false)
  const [exported, setExported] = useState(false)

  const loadScratchpad = useCallback(async () => {
    setLoadFailed(false)
    try {
      const res = await fetch('/api/scratchpad')
      await requireOk(res, 'โหลดโน้ตไม่สำเร็จ')
      const d = await res.json() as { content?: unknown }
      setContent(typeof d.content === 'string' ? d.content : '')
      setLoaded(true)
    } catch {
      // สำคัญ: ถ้าอ่านไม่สำเร็จ ห้ามเปิด auto-save เพราะข้อความว่างอาจทับโน้ตเดิม
      setLoaded(false)
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    if (suppressedByLegacyDashboard) return
    void loadScratchpad()
  }, [loadScratchpad, suppressedByLegacyDashboard])

  useEffect(() => {
    if (suppressedByLegacyDashboard || !loaded) return
    setSaveStatus('saving')
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/scratchpad', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        await requireOk(res, 'บันทึกโน้ตไม่สำเร็จ')
        setSaveStatus('saved')
      } catch {
        setSaveStatus('error')
      }
    }, 1000)

    return () => clearTimeout(timer)
  }, [content, loaded, suppressedByLegacyDashboard])

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
    setContent('')
  }

  function handleExportPrompt() {
    navigator.clipboard.writeText(buildAiPrompt(content))
      .then(() => {
        setExported(true)
        setTimeout(() => setExported(false), 2000)
      })
      .catch(() => {})
  }

  if (suppressedByLegacyDashboard) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="เปิด Quick Notes"
        className={`fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 text-xl shadow-lg transition-all hover:scale-105 hover:bg-purple-500 ${isOpen ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        📝
      </button>

      <div
        aria-hidden="true"
        onClick={() => setIsOpen(false)}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />

      <div
        className={`fixed z-50 flex flex-col bg-gray-900 shadow-2xl transition-transform duration-300 ease-out
          inset-x-0 bottom-0 h-[65vh] max-h-screen rounded-t-2xl border-t border-gray-800
          sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:left-auto sm:h-auto sm:max-h-none sm:w-[360px] sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0
          ${isOpen ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-y-0 sm:translate-x-full'}`}
        role="dialog"
        aria-modal="true"
        aria-label="Quick Notes"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-3">
          <span className="text-sm font-semibold text-gray-200">📝 Quick Notes</span>
          <button type="button" onClick={() => setIsOpen(false)} className="text-sm text-gray-500 hover:text-white" aria-label="ปิด Quick Notes">✕</button>
        </div>

        <div className="min-h-0 flex-1 p-3">
          {loadFailed ? (
            <div className="flex h-full flex-col items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-center">
              <p className="text-sm font-medium text-red-300">โหลดโน้ตไม่สำเร็จ</p>
              <p className="mt-1 text-xs text-gray-500">ระบบหยุด Auto-save ไว้เพื่อไม่ให้ข้อความว่างทับโน้ตเดิม</p>
              <button type="button" onClick={() => void loadScratchpad()} className="mt-3 rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">ลองโหลดใหม่</button>
            </div>
          ) : (
            <textarea
              value={content}
              onChange={event => setContent(event.target.value)}
              disabled={!loaded}
              placeholder={loaded ? 'จดไอเดีย ฟีเจอร์ที่อยากทำเพิ่ม...' : 'กำลังโหลดโน้ต...'}
              className="h-full w-full resize-none rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-sm text-gray-200 placeholder-gray-600 focus:border-purple-500/50 focus:outline-none disabled:opacity-50"
            />
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-gray-800 px-4 py-2.5">
          <button type="button" onClick={handleExportPrompt} disabled={!loaded} className="w-full rounded border border-purple-500/30 bg-purple-600/20 px-2.5 py-1.5 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-600/30 disabled:opacity-40">
            {exported ? '✓ คัดลอก Prompt แล้ว — ไปวางสั่งงาน AI ได้เลย' : '📤 ส่งโน้ตสั่งงาน AI'}
          </button>
          <div className="flex items-center justify-between">
            <span className={`text-xs ${saveStatus === 'error' ? 'text-red-400' : 'text-gray-500'}`}>
              {saveStatus === 'saving' ? '⏳ กำลังบันทึก...' : saveStatus === 'saved' ? '✓ บันทึกอัตโนมัติแล้ว' : saveStatus === 'error' ? '⚠️ บันทึกไม่สำเร็จ' : ''}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleClear} disabled={!loaded} className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-400 transition-colors hover:bg-red-900/40 hover:text-red-300 disabled:opacity-40">🗑️ Clear</button>
              <button type="button" onClick={handleCopy} disabled={!loaded} className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-40">
                {copied ? '✓ คัดลอกแล้ว' : '📋 Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
