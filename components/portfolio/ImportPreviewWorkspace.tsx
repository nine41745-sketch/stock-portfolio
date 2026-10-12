'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Image from 'next/image'
import {
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_PIXELS,
  MAX_SCREENSHOT_ROWS,
  parseCanonicalCsv,
  parseScreenshotOcr,
  validateScreenshotImageMetadata,
  type CsvPreview,
  type ScreenshotPreview,
} from '@/lib/import-preview'

const SAMPLE_CSV = [
  'transaction_type,symbol,shares,price,fee,amount,trade_date,currency',
  'BUY,NVDA,2,142.50,0.25,,2026-10-12,USD',
  'DIVIDEND,NVDA,,, ,12.34,2026-10-12,USD',
  'BUY,NVDA,2,142.50,0.25,,2026-10-12,USD',
].join('\n')
const SAMPLE_OCR = [
  'Symbol Shares Price Date',
  'NVDA 12 142.50 2026-10-12',
  'MSFT 4.5 521.30 2026-10-12',
  'BAD! 0 12.00 2026-10-12',
].join('\n')

type TabName = 'screenshot' | 'csv'

export default function ImportPreviewWorkspace() {
  const [tab, setTab] = useState<TabName>('screenshot')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [ocrText, setOcrText] = useState('')
  const [ocrStatus, setOcrStatus] = useState('')
  const [ocrBusy, setOcrBusy] = useState(false)
  const [imageError, setImageError] = useState('')
  const [csvText, setCsvText] = useState('')
  const [csvName, setCsvName] = useState('')
  const [csvError, setCsvError] = useState('')
  const screenshotTabRef = useRef<HTMLButtonElement>(null)
  const csvTabRef = useRef<HTMLButtonElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const key = event.key
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
    event.preventDefault()
    const nextTab = key === 'Home' ? 'screenshot' : key === 'End' ? 'csv' : tab === 'screenshot' ? 'csv' : 'screenshot'
    setTab(nextTab)
    const nextTabRef = nextTab === 'screenshot' ? screenshotTabRef : csvTabRef
    nextTabRef.current?.focus()
  }

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  const screenshotPreview: ScreenshotPreview = useMemo(() => parseScreenshotOcr(ocrText), [ocrText])
  const csvPreview: CsvPreview = useMemo(() => parseCanonicalCsv(csvText), [csvText])

  async function selectImage(file?: File) {
    setImageError('')
    setOcrStatus('')
    setOcrText('')
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImageUrl('')
    setImageFile(null)
    if (!file) return
    const problem = validateScreenshotImageMetadata({ type: file.type, size: file.size, width: 1, height: 1 })
    if (problem) {
      setImageError(problem)
      return
    }

    try {
      const bitmap = await createImageBitmap(file)
      const problem = validateScreenshotImageMetadata({ type: file.type, size: file.size, width: bitmap.width, height: bitmap.height })
      bitmap.close()
      if (problem) {
        setImageError(problem)
        return
      }
    } catch {
      setImageError('อ่านภาพไม่ได้ กรุณาเลือกไฟล์ภาพ JPG, PNG หรือ WebP ที่สมบูรณ์')
      return
    }
    setImageFile(file)
    setImageUrl(URL.createObjectURL(file))
  }

  async function runOcr() {
    if (!imageFile || ocrBusy) return
    setOcrBusy(true)
    setImageError('')
    setOcrText('')
    setOcrStatus('กำลังเตรียม OCR ในเบราว์เซอร์…')
    let worker: { recognize(image: File): Promise<{ data: { text: string } }>; terminate(): Promise<unknown> } | null = null
    try {
      const { createWorker } = await import('tesseract.js')
      worker = await createWorker('eng', 1, {
        cacheMethod: 'write',
        logger: message => {
          if (message.status === 'recognizing text') {
            setOcrStatus(`กำลังอ่านข้อความในอุปกรณ์นี้ ${Math.round(message.progress * 100)}%`)
          } else if (message.status) {
            setOcrStatus(`กำลังเตรียม OCR ในเบราว์เซอร์: ${message.status}`)
          }
        },
      })
      const result = await worker.recognize(imageFile)
      setOcrText(result.data.text.slice(0, 100_000))
      setOcrStatus('OCR เสร็จแล้ว ตรวจและแก้ข้อความก่อนใช้พรีวิว')
    } catch {
      setImageError('เริ่ม OCR ไม่สำเร็จ ตรวจการเชื่อมต่อสำหรับโหลดโมเดลภาษา แล้วลองอีกครั้ง')
      setOcrStatus('')
    } finally {
      if (worker) await worker.terminate().catch(() => undefined)
      setOcrBusy(false)
    }
  }

  async function selectCsv(file?: File) {
    setCsvError('')
    setCsvText('')
    setCsvName('')
    if (!file) return
    if (file.size === 0) {
      setCsvError('ไฟล์ CSV ว่างเปล่า')
      return
    }
    if (file.size > MAX_CSV_BYTES) {
      setCsvError(`ไฟล์ CSV ต้องมีขนาดไม่เกิน ${MAX_CSV_BYTES.toLocaleString('en-US')} ไบต์`)
      return
    }
    try {
      setCsvText(await file.text())
      setCsvName(file.name.slice(0, 120))
    } catch {
      setCsvError('อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์ CSV ที่สมบูรณ์')
    }
  }

  function clearMemory() {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    if (imageInputRef.current) imageInputRef.current.value = ''
    if (csvInputRef.current) csvInputRef.current.value = ''
    setImageUrl('')
    setImageFile(null)
    setOcrText('')
    setOcrStatus('')
    setImageError('')
    setCsvText('')
    setCsvName('')
    setCsvError('')
  }

  return (
    <section className="import-preview mx-auto w-full min-w-0 max-w-7xl space-y-4">
      <header className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-400">v1.33.0 · Local Preview</p>
            <h1 className="mt-1 text-2xl font-bold text-white">นำเข้าข้อมูลเพื่อดูตัวอย่าง</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
              ตรวจ OCR หรือ CSV ในเบราว์เซอร์นี้เท่านั้น หน้านี้ไม่มีปุ่ม Import และไม่เขียน Holdings, DIME หรือ Transaction Ledger
            </p>
          </div>
          <button type="button" onClick={clearMemory} disabled={ocrBusy} className="min-h-10 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50">
            ล้างข้อมูลชั่วคราว
          </button>
        </div>
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          พรีวิวนี้ไม่บันทึกลงพอร์ต ไฟล์และข้อความอยู่ในหน่วยความจำของหน้านี้จนกว่าจะล้างหรือปิดหน้า; โมเดล OCR อาจดาวน์โหลดจากอินเทอร์เน็ตและเก็บ cache ในเบราว์เซอร์เพื่อใช้ครั้งต่อไป ไม่มีการส่งภาพไปยังบริการ OCR ภายนอก
        </p>
      </header>

      <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="ชนิดข้อมูลนำเข้า">
        <button ref={screenshotTabRef} id="import-screenshot-tab" type="button" role="tab" aria-controls="import-screenshot-panel" aria-selected={tab === 'screenshot'} tabIndex={tab === 'screenshot' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => setTab('screenshot')} className={`min-h-11 shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold ${tab === 'screenshot' ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-800 bg-gray-900 text-gray-400'}`}>
          🖼️ ภาพ Holdings
        </button>
        <button ref={csvTabRef} id="import-csv-tab" type="button" role="tab" aria-controls="import-csv-panel" aria-selected={tab === 'csv'} tabIndex={tab === 'csv' ? 0 : -1} onKeyDown={handleTabKeyDown} onClick={() => setTab('csv')} className={`min-h-11 shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold ${tab === 'csv' ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-800 bg-gray-900 text-gray-400'}`}>
          📄 Canonical CSV
        </button>
      </div>

        <div id="import-screenshot-panel" role="tabpanel" aria-labelledby="import-screenshot-tab" hidden={tab !== 'screenshot'} className={`${tab === 'screenshot' ? 'grid' : 'hidden'} min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]`}>
          <section className="min-w-0 space-y-4 rounded-xl border border-gray-800 bg-gray-900/50 p-4 sm:p-5" aria-labelledby="screenshot-title">
            <div>
              <h2 id="screenshot-title" className="text-lg font-bold text-white">Screenshot Import · Holdings Snapshot</h2>
              <p className="mt-1 text-sm text-gray-400">เริ่มจาก Layout สังเคราะห์: Symbol · Shares · Price · Date (ภาษาอังกฤษ)</p>
            </div>
            <label className="block space-y-2 text-sm font-medium text-gray-300">
              <span>เลือกภาพ JPG, PNG หรือ WebP (ไม่เกิน {Math.round(MAX_SCREENSHOT_BYTES / (1024 * 1024))} MB / {MAX_SCREENSHOT_PIXELS / 1_000_000} MP)</span>
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={ocrBusy} onChange={event => void selectImage(event.target.files?.[0])} className="block min-h-11 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-gray-300 file:mr-3 file:min-h-8 file:rounded-md file:border-0 file:bg-gray-800 file:px-3 file:font-semibold file:text-gray-200 disabled:opacity-50" />
            </label>
            {imageUrl && <div className="relative h-64 w-full rounded-lg border border-gray-700 bg-gray-950"><Image src={imageUrl} alt="ภาพต้นฉบับสำหรับ OCR ในเครื่อง" fill unoptimized className="rounded-lg object-contain" /></div>}
            {imageFile && <p className="break-all text-xs text-gray-400">ไฟล์ชั่วคราว: {imageFile.name.slice(0, 120)}</p>}
            <button type="button" onClick={() => void runOcr()} disabled={!imageFile || ocrBusy} className="min-h-11 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              {ocrBusy ? 'กำลังประมวลผลในเบราว์เซอร์…' : 'อ่านข้อความด้วย OCR ในเครื่อง'}
            </button>
            {ocrStatus && <p aria-live="polite" className="text-sm text-gray-400">{ocrStatus}</p>}
            {imageError && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{imageError}</p>}
            <button type="button" disabled={ocrBusy} onClick={() => setOcrText(SAMPLE_OCR)} className="min-h-10 rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">ใช้ OCR fixture สังเคราะห์</button>
          </section>

          <section className="min-w-0 space-y-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4 sm:p-5" aria-labelledby="ocr-text-title">
            <div>
              <h2 id="ocr-text-title" className="text-lg font-bold text-white">ตรวจและแก้ข้อความ OCR</h2>
              <p className="mt-1 text-sm text-gray-400">รูปแบบหนึ่งรายการต่อบรรทัด: NVDA 12 142.50 2026-10-12</p>
            </div>
            <label className="sr-only" htmlFor="ocr-text">ข้อความ OCR ที่แก้ไขได้</label>
            <textarea id="ocr-text" value={ocrText} onChange={event => setOcrText(event.target.value.slice(0, 100_000))} maxLength={100_000} rows={10} placeholder="ผล OCR จะปรากฏที่นี่ หรือวางข้อความจาก Layout สังเคราะห์เพื่อทดสอบ" className="min-h-56 w-full resize-y rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-200 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none" />
            <div className="flex flex-wrap justify-between gap-2 text-xs text-gray-400"><span>ตรวจได้สูงสุด {MAX_SCREENSHOT_ROWS} รายการ · ไม่เก็บใน Storage</span><span>{ocrText.length.toLocaleString('en-US')} / 100,000</span></div>
            <p className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-xs leading-5 text-gray-400">
              ราคาใช้คำนวณมูลค่าที่เห็นใน Snapshot เท่านั้น ไม่ใช่ต้นทุนเฉลี่ย การอ่านภาพอาจผิดพลาดและต้องตรวจทานเอง
            </p>
          </section>

          <section className="min-w-0 space-y-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4 sm:p-5 lg:col-span-2" aria-labelledby="snapshot-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 id="snapshot-title" className="text-lg font-bold text-white">Preview Holdings Snapshot</h2><p className="text-xs text-gray-400">ไม่มีการส่ง API หรือแก้ไขรายการในพอร์ต</p></div>
              <span className="rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-400">ผ่าน {screenshotPreview.rows.length} · ตรวจไม่ได้ {screenshotPreview.rejected.length}</span>
            </div>
            {screenshotPreview.rows.length > 0 ? (
              <div role="region" aria-label="ตาราง Holdings Snapshot เลื่อนแนวนอนได้" tabIndex={0} className="overflow-x-auto rounded-lg border border-gray-800">
                <table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-gray-800/60 text-xs text-gray-400"><tr><th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Shares</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">วันที่ในภาพ</th><th className="px-3 py-2">มูลค่าที่คำนวณ</th></tr></thead><tbody className="divide-y divide-gray-800">{screenshotPreview.rows.map(row => <tr key={`${row.line}-${row.symbol}`}><td className="px-3 py-2 font-bold text-white">{row.symbol}</td><td className="px-3 py-2 text-gray-300">{row.shares}</td><td className="px-3 py-2 text-gray-300">${row.price.toFixed(2)}</td><td className="px-3 py-2 text-gray-400">{row.date}</td><td className="px-3 py-2 text-gray-300">${row.marketValue.toFixed(2)}</td></tr>)}</tbody></table>
              </div>
            ) : <p className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-4 text-sm text-gray-400">ยังไม่มีบรรทัดที่ผ่าน Validation</p>}
            {screenshotPreview.rejected.length > 0 && <ul className="space-y-2">{screenshotPreview.rejected.map((row, index) => <li key={`${row.line}-${index}`} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><span className="font-semibold text-amber-300">บรรทัด {row.line || '—'} · {row.reason}</span>{row.text && <p className="mt-1 break-all font-mono text-xs text-gray-400">{row.text}</p>}</li>)}</ul>}
          </section>
        </div>
        <div id="import-csv-panel" role="tabpanel" aria-labelledby="import-csv-tab" hidden={tab !== 'csv'} className={`${tab === 'csv' ? 'grid' : 'hidden'} min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]`}>
          <section className="min-w-0 space-y-4 rounded-xl border border-gray-800 bg-gray-900/50 p-4 sm:p-5" aria-labelledby="csv-title">
            <div><h2 id="csv-title" className="text-lg font-bold text-white">Broker CSV · Canonical Contract</h2><p className="mt-1 text-sm text-gray-400">รับเฉพาะ canonical template นี้ ยังไม่รองรับรูปแบบ CSV ของโบรกเกอร์รายใด</p></div>
            <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 p-3"><p className="mb-2 text-xs font-semibold text-gray-400">Headers ที่ต้องมี</p><code className="break-all font-mono text-xs leading-6 text-blue-200">transaction_type,symbol,shares,price,fee,amount,trade_date,currency</code></div>
            <p className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-xs leading-5 text-gray-400">วันที่ใช้ YYYY-MM-DD · currency ต้องเป็น USD · ประเภท: BUY, SELL, OPENING_POSITION, DIVIDEND, DEPOSIT, WITHDRAW · สูงสุด {MAX_CSV_ROWS} แถวและ {MAX_CSV_BYTES.toLocaleString('en-US')} ไบต์</p>
            <div className="flex flex-wrap gap-2">
              <label className="block w-full min-w-0 space-y-2 text-sm font-medium text-gray-300">
                <span>เลือกไฟล์ CSV</span><input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={event => void selectCsv(event.target.files?.[0])} className="block min-h-11 w-full rounded-lg border border-gray-700 bg-gray-950 p-2 text-sm text-gray-300 file:mr-3 file:min-h-8 file:rounded-md file:border-0 file:bg-gray-800 file:px-3 file:font-semibold file:text-gray-200" />
              </label>
              <button type="button" onClick={() => { setCsvName('synthetic-fixture.csv'); setCsvText(SAMPLE_CSV); setCsvError('') }} className="min-h-10 rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800">ใช้ CSV fixture สังเคราะห์</button>
            </div>
            {csvName && <p className="break-all text-xs text-gray-400">ไฟล์ชั่วคราว: {csvName}</p>}
            {csvError && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{csvError}</p>}
            <label className="block space-y-2 text-sm font-medium text-gray-300" htmlFor="csv-text"><span>ตรวจและแก้ CSV ก่อนพรีวิว</span><textarea id="csv-text" value={csvText} onChange={event => setCsvText(event.target.value.slice(0, MAX_CSV_BYTES))} maxLength={MAX_CSV_BYTES} rows={10} placeholder="เลือกไฟล์ หรือใช้ fixture สังเคราะห์" className="min-h-64 w-full resize-y rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs text-gray-200 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none" /></label>
            <p className="text-xs text-gray-400">ไม่มีการบันทึก Raw CSV, Local Storage, IndexedDB หรือ API · React จะแสดงข้อมูลเป็นข้อความที่ escape แล้ว</p>
          </section>

          <section className="min-w-0 space-y-3 rounded-xl border border-gray-800 bg-gray-900/50 p-4 sm:p-5" aria-labelledby="csv-preview-title">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id="csv-preview-title" className="text-lg font-bold text-white">Preview ธุรกรรม</h2><p className="text-xs text-gray-400">ไม่บันทึก Transaction Ledger และไม่เปลี่ยน Holdings/DIME</p></div><span className="rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-400">ผ่าน {csvPreview.rows.length} · Rejected {csvPreview.rejected.length}</span></div>
            {csvPreview.errors.map((error, index) => <p key={index} role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>)}
            {csvPreview.warnings.map((warning, index) => <p key={index} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">{warning}</p>)}
            {csvPreview.rows.length > 0 ? <div role="region" aria-label="ตาราง Preview ธุรกรรมเลื่อนแนวนอนได้" tabIndex={0} className="overflow-x-auto rounded-lg border border-gray-800"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-gray-800/60 text-xs text-gray-400"><tr><th className="px-3 py-2">บรรทัด</th><th className="px-3 py-2">ประเภท</th><th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Shares / Amount</th><th className="px-3 py-2">Price / Fee</th><th className="px-3 py-2">วันที่</th><th className="px-3 py-2">หมายเหตุ</th></tr></thead><tbody className="divide-y divide-gray-800">{csvPreview.rows.map(row => <tr key={row.line}><td className="px-3 py-2 text-gray-400">{row.line}</td><td className="px-3 py-2 font-semibold text-gray-200">{row.transaction.transaction_type}</td><td className="px-3 py-2 text-gray-300">{row.transaction.symbol ?? '—'}</td><td className="px-3 py-2 text-gray-300">{row.transaction.shares ?? row.transaction.amount ?? '—'}</td><td className="px-3 py-2 text-gray-300">{row.transaction.price ?? '—'} / {row.transaction.fee ?? '—'}</td><td className="px-3 py-2 text-gray-400">{row.transaction.trade_date}</td><td className="px-3 py-2">{row.duplicateCandidate ? <span className="text-amber-300">Duplicate Candidate · ยังอยู่ในพรีวิว</span> : <span className="text-gray-400">—</span>}</td></tr>)}</tbody></table></div> : !csvPreview.errors.length && <p className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-4 text-sm text-gray-400">ยังไม่มีรายการที่ผ่าน Validation</p>}
            {csvPreview.rejected.length > 0 && <div className="space-y-2"><h3 className="font-semibold text-amber-300">Rejected / Ambiguous Rows</h3>{csvPreview.rejected.map((row, index) => <div key={`${row.line}-${index}`} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><p className="font-semibold text-amber-300">บรรทัด {row.line}: {row.reason}</p><p className="mt-1 break-all font-mono text-xs text-gray-400">{row.sample}</p></div>)}</div>}
          </section>
        </div>
    </section>
  )
}
