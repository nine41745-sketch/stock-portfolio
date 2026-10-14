'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

type ScannerUniverse = 'ai' | 'semis' | 'growth' | 'quality' | 'mine'
type ScannerSetup = 'BREAKOUT' | 'PULLBACK' | 'NEAR_SUPPORT' | 'MOMENTUM' | 'WAIT' | 'AVOID'
type ScannerSort = 'score' | 'volume' | 'relative' | 'rr' | 'support' | 'importantSupport' | 'ath'
type AthFilter = 'all' | 'ath' | 'near'

type ScannerItem = {
  symbol: string
  score: number
  label: 'น่าสนใจ' | 'เฝ้าดู' | 'ยังไม่เด่น'
  setup: ScannerSetup
  reasons: string[]
  categoryScores: {
    trend: number
    momentum: number
    volume: number
    priceLocation: number
    relativeStrength: number
    riskCatalyst: number
  }
  price: number | null
  dayChangePct: number | null
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'UNKNOWN'
  ema50: number | null
  ema200: number | null
  rsi14: number | null
  weeklyRsi14: number | null
  macdHistogram: number | null
  support: number | null
  resistance: number | null
  importantSupport: number | null
  importantSupportTouches: number
  volumeRatio: number | null
  week52High: number | null
  week52Low: number | null
  allTimeHigh: number | null
  athDistancePct: number | null
  athStatus: 'ATH' | 'NEAR_ATH' | 'BELOW_ATH' | 'UNKNOWN'
  return20dPct: number | null
  return60dPct: number | null
  relativeStrength20: number | null
  relativeStrength60: number | null
  riskReward: number | null
  earnings: { date: string; daysUntil: number; hour: string | null } | null
}

type WatchlistItem = {
  id: string
  symbol: string
  collection_id: string | null
  target_price: number | null
  note: string | null
  alert_enabled: boolean
  current_price: number | null
  price_observation?: { source: string | null; fetchedAt: string | null; providerTimestamp: string | null; freshness: string }
  smart_alert?: { status: 'disabled' | 'not-evaluated' | 'unavailable' | 'triggered' | 'watching'; reason: string }
  created_at: string
  updated_at: string
}

type WatchlistCollection = { id: string; name: string; sort_order: number }
type RuleType = 'PRICE_AT_OR_BELOW' | 'PRICE_AT_OR_ABOVE' | 'DIME_AT_OR_BELOW' | 'CASH_AT_OR_BELOW' | 'ALLOCATION_AT_OR_BELOW' | 'POSITION_WEIGHT_AT_OR_ABOVE'
type InvestmentRule = { id: string; name: string; rule_type: RuleType; symbol: string | null; threshold: number; enabled: boolean }
type RuleEvaluation = { id: string; status: 'triggered' | 'not-triggered' | 'unavailable' | 'disabled'; reason: string; observedValue: number | null }
type SupportLadder = { status: string; source: string | null; lastBarAt: string | null; freshness: string; levels: Array<{ kind: string; price: number }>; methodology: string }

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  } catch {
    // use fallback
  }
  return fallback
}

function scoreStyle(score: number): string {
  if (score >= 72) return 'border-green-500/30 bg-green-500/15 text-green-400'
  if (score >= 58) return 'border-yellow-500/30 bg-yellow-500/15 text-yellow-400'
  return 'border-gray-700 bg-gray-800/60 text-gray-400'
}

function trendLabel(trend: ScannerItem['trend']): string {
  if (trend === 'UPTREND') return 'ขาขึ้น'
  if (trend === 'DOWNTREND') return 'ขาลง'
  if (trend === 'SIDEWAYS') return 'Sideway'
  return 'ไม่ทราบ'
}

function setupLabel(setup: ScannerSetup): string {
  if (setup === 'BREAKOUT') return '🚀 Breakout'
  if (setup === 'PULLBACK') return '🎯 Pullback'
  if (setup === 'NEAR_SUPPORT') return '🟢 Near Support'
  if (setup === 'MOMENTUM') return '🔥 Momentum'
  if (setup === 'AVOID') return '🔴 Avoid'
  return '⏳ Wait'
}

function setupStyle(setup: ScannerSetup): string {
  if (setup === 'BREAKOUT' || setup === 'MOMENTUM') return 'border-green-500/30 bg-green-500/10 text-green-400'
  if (setup === 'PULLBACK' || setup === 'NEAR_SUPPORT') return 'border-blue-500/30 bg-blue-500/10 text-blue-400'
  if (setup === 'AVOID') return 'border-red-500/30 bg-red-500/10 text-red-400'
  return 'border-gray-700 bg-gray-800/60 text-gray-400'
}

function fmtPrice(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(value: number | null, digits = 1): string {
  if (value === null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function fmtRatio(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}:1`
}

function supportDistance(item: ScannerItem): number | null {
  if (item.price === null || item.support === null || item.support <= 0) return null
  return ((item.price - item.support) / item.support) * 100
}

function importantSupportDistance(item: ScannerItem): number | null {
  if (item.price === null || item.importantSupport === null || item.importantSupport <= 0) return null
  return ((item.price - item.importantSupport) / item.importantSupport) * 100
}

function importantSupportLabel(item: ScannerItem): string {
  const distance = importantSupportDistance(item)
  if (distance === null) return '—'
  if (distance < 0) return `หลุด ${Math.abs(distance).toFixed(1)}%`
  if (distance <= 3) return `ใกล้ +${distance.toFixed(1)}%`
  return `ห่าง +${distance.toFixed(1)}%`
}

function athStatusLabel(item: ScannerItem): string {
  if (item.athStatus === 'ATH') return '🏆 ATH'
  if (item.athStatus === 'NEAR_ATH' && item.athDistancePct !== null) return `ใกล้ ATH -${item.athDistancePct.toFixed(1)}%`
  if (item.athDistancePct !== null) return `ห่าง ${item.athDistancePct.toFixed(1)}%`
  return '—'
}

function athStatusStyle(item: ScannerItem): string {
  if (item.athStatus === 'ATH') return 'text-yellow-300'
  if (item.athStatus === 'NEAR_ATH') return 'text-green-400'
  return 'text-gray-400'
}

function earningsLabel(item: ScannerItem): string {
  if (!item.earnings) return '—'
  if (item.earnings.daysUntil <= 0) return 'วันนี้'
  return `${item.earnings.daysUntil} วัน`
}

export default function OpportunityHub({ holdingSymbols }: { holdingSymbols: string[] }) {
  const heldSet = useMemo(() => new Set(holdingSymbols.map(s => s.toUpperCase())), [holdingSymbols])
  const [tab, setTab] = useState<'scanner' | 'watchlist'>('scanner')
  const [universe, setUniverse] = useState<ScannerUniverse>('ai')
  const [scannerItems, setScannerItems] = useState<ScannerItem[]>([])
  const [scannerLoading, setScannerLoading] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [scannedAt, setScannedAt] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<ScannerItem | null>(null)

  const [setupFilter, setSetupFilter] = useState<'all' | ScannerSetup>('all')
  const [minScore, setMinScore] = useState(0)
  const [minVolume, setMinVolume] = useState(0)
  const [athFilter, setAthFilter] = useState<AthFilter>('all')
  const [importantSupportOnly, setImportantSupportOnly] = useState(false)
  const [uptrendOnly, setUptrendOnly] = useState(false)
  const [hideEarnings7d, setHideEarnings7d] = useState(false)
  const [hideHeld, setHideHeld] = useState(false)
  const [sortBy, setSortBy] = useState<ScannerSort>('score')

  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [watchlistLoading, setWatchlistLoading] = useState(true)
  const [watchlistError, setWatchlistError] = useState<string | null>(null)
  const [collections, setCollections] = useState<WatchlistCollection[]>([])
  const [collectionFilter, setCollectionFilter] = useState('all')
  const [selectedCollection, setSelectedCollection] = useState('')
  const [collectionName, setCollectionName] = useState('')
  const [renamingCollectionId, setRenamingCollectionId] = useState<string | null>(null)
  const [renamingCollectionName, setRenamingCollectionName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [targetPrice, setTargetPrice] = useState('')
  const [note, setNote] = useState('')
  const [alertEnabled, setAlertEnabled] = useState(true)
  const [savingSymbol, setSavingSymbol] = useState<string | null>(null)
  const [quoteRefreshing, setQuoteRefreshing] = useState(false)
  const [rules, setRules] = useState<InvestmentRule[]>([])
  const [rulesLoading, setRulesLoading] = useState(true)
  const [ruleName, setRuleName] = useState('')
  const [ruleType, setRuleType] = useState<RuleType>('PRICE_AT_OR_BELOW')
  const [ruleSymbol, setRuleSymbol] = useState('')
  const [ruleThreshold, setRuleThreshold] = useState('')
  const [ruleBusy, setRuleBusy] = useState(false)
  const [ruleError, setRuleError] = useState<string | null>(null)
  const [ruleResults, setRuleResults] = useState<RuleEvaluation[]>([])
  const [ruleEvaluatedAt, setRuleEvaluatedAt] = useState<string | null>(null)
  const [supportLadders, setSupportLadders] = useState<Record<string, SupportLadder | null>>({})
  const [supportLoading, setSupportLoading] = useState<string | null>(null)

  const loadWatchlist = useCallback(async () => {
    try {
      const response = await fetch('/api/watchlist', { cache: 'no-store' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'โหลด Watchlist ไม่สำเร็จ'))
      const data = await response.json() as { items?: WatchlistItem[]; collections?: WatchlistCollection[] }
      setWatchlist(Array.isArray(data.items) ? data.items : [])
      setCollections(Array.isArray(data.collections) ? data.collections : [])
      setWatchlistError(null)
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : 'โหลด Watchlist ไม่สำเร็จ')
    } finally {
      setWatchlistLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWatchlist() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadWatchlist])

  const loadRules = useCallback(async () => {
    try {
      const response = await fetch('/api/watchlist/rules', { cache: 'no-store' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'โหลดกฎการลงทุนไม่สำเร็จ'))
      const data = await response.json() as { rules?: InvestmentRule[] }
      setRules(Array.isArray(data.rules) ? data.rules : [])
      setRuleError(null)
    } catch (error) {
      setRuleError(error instanceof Error ? error.message : 'โหลดกฎการลงทุนไม่สำเร็จ')
    } finally { setRulesLoading(false) }
  }, [])

  useEffect(() => { const timer = window.setTimeout(() => { void loadRules() }, 0); return () => window.clearTimeout(timer) }, [loadRules])

  async function refreshWatchlistQuotes() {
    setQuoteRefreshing(true)
    try {
      const response = await fetch('/api/watchlist?quotes=1', { cache: 'no-store' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'อัปเดตราคาไม่สำเร็จ'))
      const data = await response.json() as { items?: WatchlistItem[]; collections?: WatchlistCollection[] }
      setWatchlist(Array.isArray(data.items) ? data.items : [])
      if (Array.isArray(data.collections)) setCollections(data.collections)
      setWatchlistError(null)
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : 'อัปเดตราคาไม่สำเร็จ')
    } finally { setQuoteRefreshing(false) }
  }

  async function runScanner() {
    setScannerLoading(true)
    setScannerError(null)
    setSelectedItem(null)
    try {
      const response = await fetch(`/api/scanner?universe=${universe}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'สแกนหุ้นไม่สำเร็จ'))
      const data = await response.json() as { items?: ScannerItem[]; scannedAt?: string }
      const items = Array.isArray(data.items) ? data.items : []
      setScannerItems(items)
      setScannedAt(data.scannedAt ?? new Date().toISOString())
    } catch (error) {
      setScannerItems([])
      setScannerError(error instanceof Error ? error.message : 'สแกนหุ้นไม่สำเร็จ')
    } finally {
      setScannerLoading(false)
    }
  }

  async function saveWatchlistItem(payload: { symbol: string; target_price?: number | null; note?: string | null; collection_id?: string | null; alert_enabled?: boolean }) {
    const normalized = payload.symbol.trim().toUpperCase()
    if (!normalized) return
    setSavingSymbol(normalized)
    try {
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'บันทึก Watchlist ไม่สำเร็จ'))
      await loadWatchlist()
      setWatchlistError(null)
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : 'บันทึก Watchlist ไม่สำเร็จ')
      throw error
    } finally {
      setSavingSymbol(null)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const normalized = symbol.trim().toUpperCase()
    if (!normalized) return
    try {
      await saveWatchlistItem({
        symbol: normalized,
        target_price: targetPrice.trim() ? Number(targetPrice) : null,
        note: note.trim() || null,
      collection_id: selectedCollection || null,
      alert_enabled: alertEnabled,
      })
      setSymbol('')
      setTargetPrice('')
      setNote('')
    } catch {
      // error already displayed
    }
  }

  function editWatchlistItem(item: WatchlistItem) {
    setTab('watchlist')
    setSymbol(item.symbol)
    setTargetPrice(item.target_price === null ? '' : String(item.target_price))
    setNote(item.note ?? '')
    setSelectedCollection(item.collection_id ?? '')
    setAlertEnabled(item.alert_enabled)
  }

  async function removeWatchlistItem(itemSymbol: string) {
    setSavingSymbol(itemSymbol)
    try {
      const response = await fetch(`/api/watchlist?symbol=${encodeURIComponent(itemSymbol)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'ลบจาก Watchlist ไม่สำเร็จ'))
      setWatchlist(prev => prev.filter(item => item.symbol !== itemSymbol))
      setWatchlistError(null)
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : 'ลบจาก Watchlist ไม่สำเร็จ')
    } finally {
      setSavingSymbol(null)
    }
  }

  async function createCollection(event: FormEvent) {
    event.preventDefault()
    const name = collectionName.trim()
    if (!name) return
    try {
      const response = await fetch('/api/watchlist/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'สร้าง Collection ไม่สำเร็จ'))
      const data = await response.json() as { collection: WatchlistCollection }
      setCollections(prev => [...prev, data.collection].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)))
      setCollectionName('')
    } catch (error) { setWatchlistError(error instanceof Error ? error.message : 'สร้าง Collection ไม่สำเร็จ') }
  }

  async function renameCollection(id: string) {
    try {
      const response = await fetch('/api/watchlist/collections', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: renamingCollectionName }) })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'แก้ไข Collection ไม่สำเร็จ'))
      const data = await response.json() as { collection: WatchlistCollection }
      setCollections(prev => prev.map(item => item.id === id ? data.collection : item))
      setRenamingCollectionId(null)
      setRenamingCollectionName('')
    } catch (error) { setWatchlistError(error instanceof Error ? error.message : 'แก้ไข Collection ไม่สำเร็จ') }
  }

  async function deleteCollection(id: string) {
    try {
      const response = await fetch(`/api/watchlist/collections?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'ลบ Collection ไม่สำเร็จ'))
      setCollections(prev => prev.filter(item => item.id !== id))
      setWatchlist(prev => prev.map(item => item.collection_id === id ? { ...item, collection_id: null } : item))
      if (selectedCollection === id) setSelectedCollection('')
      if (collectionFilter === id) setCollectionFilter('all')
      setWatchlistError(null)
    } catch (error) { setWatchlistError(error instanceof Error ? error.message : 'ลบ Collection ไม่สำเร็จ') }
  }

  async function createRule(event: FormEvent) {
    event.preventDefault()
    setRuleBusy(true)
    setRuleError(null)
    try {
      const needsSymbol = ['PRICE_AT_OR_BELOW', 'PRICE_AT_OR_ABOVE', 'ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'].includes(ruleType)
      const response = await fetch('/api/watchlist/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ruleName, rule_type: ruleType, symbol: needsSymbol ? ruleSymbol : null, threshold: Number(ruleThreshold) }) })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'บันทึกกฎไม่สำเร็จ'))
      const data = await response.json() as { rule: InvestmentRule }
      setRules(prev => [data.rule, ...prev])
      setRuleName(''); setRuleSymbol(''); setRuleThreshold('')
    } catch (error) { setRuleError(error instanceof Error ? error.message : 'บันทึกกฎไม่สำเร็จ') }
    finally { setRuleBusy(false) }
  }

  async function deleteRule(id: string) {
    setRuleBusy(true)
    try {
      const response = await fetch(`/api/watchlist/rules?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'ลบกฎไม่สำเร็จ'))
      setRules(prev => prev.filter(rule => rule.id !== id))
      setRuleResults(prev => prev.filter(result => result.id !== id))
    } catch (error) { setRuleError(error instanceof Error ? error.message : 'ลบกฎไม่สำเร็จ') }
    finally { setRuleBusy(false) }
  }

  async function evaluateRules() {
    setRuleBusy(true); setRuleError(null)
    try {
      const response = await fetch('/api/watchlist/rules/evaluate', { method: 'POST', cache: 'no-store' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'ประเมินกฎไม่สำเร็จ'))
      const data = await response.json() as { results?: RuleEvaluation[]; evaluatedAt?: string }
      setRuleResults(Array.isArray(data.results) ? data.results : [])
      setRuleEvaluatedAt(data.evaluatedAt ?? new Date().toISOString())
    } catch (error) { setRuleError(error instanceof Error ? error.message : 'ประเมินกฎไม่สำเร็จ') }
    finally { setRuleBusy(false) }
  }

  async function loadSupportLadder(itemSymbol: string) {
    if (supportLadders[itemSymbol]) { setSupportLadders(prev => ({ ...prev, [itemSymbol]: null })); return }
    setSupportLoading(itemSymbol)
    try {
      const response = await fetch(`/api/watchlist/support?symbol=${encodeURIComponent(itemSymbol)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await getErrorMessage(response, 'แนวรับ/แนวต้านยังไม่พร้อม'))
      const data = await response.json() as { ladder: SupportLadder }
      setSupportLadders(prev => ({ ...prev, [itemSymbol]: data.ladder }))
    } catch (error) { setWatchlistError(error instanceof Error ? error.message : 'โหลดแนวรับ/แนวต้านไม่สำเร็จ') }
    finally { setSupportLoading(null) }
  }

  const visibleWatchlist = useMemo(() => collectionFilter === 'all'
    ? watchlist
    : watchlist.filter(item => item.collection_id === collectionFilter), [watchlist, collectionFilter])

  const filteredItems = useMemo(() => {
    const filtered = scannerItems.filter(item => {
      if (setupFilter !== 'all' && item.setup !== setupFilter) return false
      if (item.score < minScore) return false
      if (minVolume > 0 && (item.volumeRatio ?? 0) < minVolume) return false
      if (athFilter === 'ath' && item.athStatus !== 'ATH') return false
      if (athFilter === 'near' && item.athStatus !== 'ATH' && item.athStatus !== 'NEAR_ATH') return false
      if (importantSupportOnly) {
        const distance = importantSupportDistance(item)
        if (distance === null || distance > 3 || distance < -5) return false
      }
      if (uptrendOnly && item.trend !== 'UPTREND') return false
      if (hideEarnings7d && item.earnings && item.earnings.daysUntil <= 7) return false
      if (hideHeld && heldSet.has(item.symbol)) return false
      return true
    })

    return [...filtered].sort((a, b) => {
      if (sortBy === 'volume') return (b.volumeRatio ?? -1) - (a.volumeRatio ?? -1) || b.score - a.score
      if (sortBy === 'relative') return (b.relativeStrength20 ?? -999) - (a.relativeStrength20 ?? -999) || b.score - a.score
      if (sortBy === 'rr') return (b.riskReward ?? -1) - (a.riskReward ?? -1) || b.score - a.score
      if (sortBy === 'support') return (supportDistance(a) ?? 999) - (supportDistance(b) ?? 999) || b.score - a.score
      if (sortBy === 'importantSupport') return Math.abs(importantSupportDistance(a) ?? 999) - Math.abs(importantSupportDistance(b) ?? 999) || b.score - a.score
      if (sortBy === 'ath') return (a.athDistancePct ?? 999) - (b.athDistancePct ?? 999) || b.score - a.score
      return b.score - a.score || a.symbol.localeCompare(b.symbol)
    })
  }, [scannerItems, setupFilter, minScore, minVolume, athFilter, importantSupportOnly, uptrendOnly, hideEarnings7d, hideHeld, heldSet, sortBy])

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 shadow-sm md:p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Opportunity Scanner</p>
          <h1 className="text-xl font-bold text-white md:text-2xl">🔎 สแกนหุ้น</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-400">
            คัดหุ้นจาก Trend, Momentum, Volume, Price Location, Relative Strength เทียบ SPY และ Earnings Risk โดยไม่ใช้ AI
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-700 bg-gray-950/60 p-1">
          <button
            type="button"
            onClick={() => setTab('scanner')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'scanner' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'}`}
          >🔎 สแกน</button>
          <button
            type="button"
            onClick={() => setTab('watchlist')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'watchlist' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'}`}
          >⭐ หุ้นที่เล็งไว้ {watchlist.length > 0 ? `(${watchlist.length})` : ''}</button>
        </div>
      </div>

      {tab === 'scanner' ? (
        <div>
          <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(180px,1fr)_auto]">
            <div className="flex flex-wrap gap-2">
              <select
                value={universe}
                onChange={e => setUniverse(e.target.value as ScannerUniverse)}
                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="ai">AI / Mega Tech</option>
                <option value="semis">Semiconductor</option>
                <option value="growth">Growth / Software</option>
                <option value="quality">Quality Leaders</option>
                <option value="mine">Holdings + Watchlist ในพอร์ตที่เลือก</option>
              </select>
              <button
                type="button"
                onClick={() => void runScanner()}
                disabled={scannerLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >{scannerLoading ? 'กำลังสแกน...' : 'เริ่มสแกน'}</button>
              {scannedAt && !scannerLoading && (
                <span className="self-center text-xs text-gray-400">
                  ล่าสุด {new Date(scannedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })} ICT
                </span>
              )}
            </div>
            {scannerItems.length > 0 && (
              <div className="self-center text-right text-xs text-gray-400">แสดง {filteredItems.length}/{scannerItems.length} ตัว</div>
            )}
          </div>
            {universe === 'mine' && (
              <p role="note" className="mb-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
                แสดง Holdings และ Watchlist ของพอร์ตที่เลือกเท่านั้น; ข้อมูล Watchlist ระดับบัญชีเดิมไม่ถูกรวม
              </p>
            )}
            <div className="mb-4 grid gap-2 rounded-xl border border-gray-800 bg-gray-950/50 p-3 md:grid-cols-2 xl:grid-cols-5">
            <select value={setupFilter} onChange={e => setSetupFilter(e.target.value as 'all' | ScannerSetup)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white">
              <option value="all">Setup: ทั้งหมด</option>
              <option value="BREAKOUT">Breakout</option>
              <option value="PULLBACK">Pullback</option>
              <option value="NEAR_SUPPORT">Near Support</option>
              <option value="MOMENTUM">Momentum</option>
              <option value="WAIT">Wait</option>
              <option value="AVOID">Avoid</option>
            </select>
            <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white">
              <option value="0">Score: ทั้งหมด</option>
              <option value="60">Score ≥ 60</option>
              <option value="70">Score ≥ 70</option>
              <option value="80">Score ≥ 80</option>
            </select>
            <select value={minVolume} onChange={e => setMinVolume(Number(e.target.value))} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white">
              <option value="0">Volume: ทั้งหมด</option>
              <option value="1.2">Volume ≥ 1.2x</option>
              <option value="1.5">Volume ≥ 1.5x</option>
            </select>
            <select value={athFilter} onChange={e => setAthFilter(e.target.value as AthFilter)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white">
              <option value="all">ATH: ทั้งหมด</option>
              <option value="ath">ATH เท่านั้น</option>
              <option value="near">ATH / ใกล้ ATH ≤ 3%</option>
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as ScannerSort)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white">
              <option value="score">เรียง: Score สูงสุด</option>
              <option value="volume">เรียง: Volume สูงสุด</option>
              <option value="relative">เรียง: RS20 สูงสุด</option>
              <option value="rr">เรียง: R:R สูงสุด</option>
              <option value="support">เรียง: ใกล้แนวรับ</option>
              <option value="importantSupport">เรียง: ใกล้แนวรับสำคัญ</option>
              <option value="ath">เรียง: ใกล้ ATH</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={importantSupportOnly} onChange={e => setImportantSupportOnly(e.target.checked)} />ใกล้/หลุดแนวรับสำคัญ</label>
            <label className="flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={uptrendOnly} onChange={e => setUptrendOnly(e.target.checked)} />เฉพาะ Uptrend</label>
            <label className="flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={hideEarnings7d} onChange={e => setHideEarnings7d(e.target.checked)} />ซ่อนงบ ≤ 7 วัน</label>
            <label className="flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={hideHeld} onChange={e => setHideHeld(e.target.checked)} />ซ่อนหุ้นที่ถืออยู่</label>
            <button
              type="button"
              onClick={() => {
                setSetupFilter('all')
                setMinScore(0)
                setMinVolume(0)
                setAthFilter('all')
                setImportantSupportOnly(false)
                setUptrendOnly(false)
                setHideEarnings7d(false)
                setHideHeld(false)
                setSortBy('score')
              }}
              className="rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-400 hover:bg-gray-800"
            >ล้างตัวกรอง</button>
          </div>

          {scannerError && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">⚠️ {scannerError}</p>}

          {!scannerLoading && !scannerError && scannerItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-400">เลือกกลุ่มแล้วกด “เริ่มสแกน” เพื่อจัดอันดับหุ้นที่มี Technical setup เด่นในตอนนี้</p>
          ) : !scannerLoading && scannerItems.length > 0 && filteredItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-400">ไม่มีหุ้นที่ผ่านตัวกรองนี้</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="min-w-[1510px] w-full text-left text-xs">
                <thead className="bg-gray-950/80 text-gray-400">
                  <tr>
                    <th className="px-3 py-2.5">หุ้น</th>
                    <th className="px-3 py-2.5">Score</th>
                    <th className="px-3 py-2.5">Setup</th>
                    <th className="px-3 py-2.5">ราคา / Day</th>
                    <th className="px-3 py-2.5">Trend</th>
                    <th className="px-3 py-2.5">RSI D/W</th>
                    <th className="px-3 py-2.5">Vol</th>
                    <th className="px-3 py-2.5">Support</th>
                    <th className="px-3 py-2.5">แนวรับสำคัญ</th>
                    <th className="px-3 py-2.5">Resistance</th>
                    <th className="px-3 py-2.5">RS20</th>
                    <th className="px-3 py-2.5">52W High</th>
                    <th className="px-3 py-2.5">All-Time High</th>
                    <th className="px-3 py-2.5">R:R</th>
                    <th className="px-3 py-2.5">Earnings</th>
                    <th className="px-3 py-2.5">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {filteredItems.map(item => {
                    const held = heldSet.has(item.symbol)
                    const alreadyWatching = watchlist.some(w => w.symbol === item.symbol)
                    const earningsRisk = item.earnings !== null && item.earnings.daysUntil <= 7
                    return (
                      <tr key={item.symbol} className="bg-gray-900/40 text-gray-300 hover:bg-gray-800">
                        <td className="px-3 py-3">
                          <button type="button" onClick={() => setSelectedItem(item)} className="font-bold text-white hover:text-blue-400">{item.symbol}</button>
                          {held && <span className="ml-1.5 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-400">ถืออยู่</span>}
                          {item.athStatus === 'ATH' && <span className="ml-1.5 rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-300">🏆 ATH</span>}
                          {item.athStatus === 'NEAR_ATH' && <span className="ml-1.5 rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-400">ใกล้ ATH</span>}
                          {importantSupportDistance(item) !== null && importantSupportDistance(item)! >= 0 && importantSupportDistance(item)! <= 3 && <span className="ml-1.5 rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-300">🛡️ ใกล้แนวรับสำคัญ</span>}
                          {importantSupportDistance(item) !== null && importantSupportDistance(item)! < 0 && importantSupportDistance(item)! >= -5 && <span className="ml-1.5 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300">⚠️ หลุดแนวรับสำคัญ</span>}
                        </td>
                        <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 font-bold ${scoreStyle(item.score)}`}>{item.score}</span></td>
                        <td className="px-3 py-3"><span className={`rounded border px-2 py-1 ${setupStyle(item.setup)}`}>{setupLabel(item.setup)}</span></td>
                        <td className="px-3 py-3"><div className="font-semibold text-gray-200">{fmtPrice(item.price)}</div><div className={(item.dayChangePct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}>{fmtPct(item.dayChangePct, 2)}</div></td>
                        <td className="px-3 py-3">{trendLabel(item.trend)}</td>
                        <td className="px-3 py-3">{item.rsi14?.toFixed(1) ?? '—'} / {item.weeklyRsi14?.toFixed(1) ?? '—'}</td>
                        <td className="px-3 py-3">{item.volumeRatio === null ? '—' : `${item.volumeRatio.toFixed(2)}x`}</td>
                        <td className="px-3 py-3">{fmtPrice(item.support)}<div className="text-[10px] text-gray-400">ห่าง {supportDistance(item) === null ? '—' : `${supportDistance(item)!.toFixed(1)}%`}</div></td>
                        <td className="px-3 py-3"><div>{fmtPrice(item.importantSupport)}</div><div className={`text-[10px] ${importantSupportDistance(item) !== null && importantSupportDistance(item)! < 0 ? 'text-red-400' : 'text-cyan-400'}`}>{importantSupportLabel(item)}{item.importantSupportTouches > 0 ? ` · ${item.importantSupportTouches} touches` : ''}</div></td>
                        <td className="px-3 py-3">{fmtPrice(item.resistance)}</td>
                        <td className={`px-3 py-3 ${(item.relativeStrength20 ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtPct(item.relativeStrength20)}</td>
                        <td className="px-3 py-3">{fmtPrice(item.week52High)}</td>
                        <td className="px-3 py-3"><div>{fmtPrice(item.allTimeHigh)}</div><div className={`text-[10px] ${athStatusStyle(item)}`}>{athStatusLabel(item)}</div></td>
                        <td className="px-3 py-3">{fmtRatio(item.riskReward)}</td>
                        <td className={`px-3 py-3 ${earningsRisk ? 'font-semibold text-orange-400' : ''}`}>{earningsLabel(item)}</td>
                        <td className="px-3 py-3">
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => setSelectedItem(item)} className="rounded border border-gray-700 px-2 py-1 text-gray-400 hover:bg-gray-800">รายละเอียด</button>
                            <button
                              type="button"
                              disabled={held || alreadyWatching || savingSymbol === item.symbol}
                              onClick={() => { void saveWatchlistItem({ symbol: item.symbol }).catch(() => {}) }}
                              className="rounded border border-gray-700 px-2 py-1 text-gray-300 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >{held ? 'ในพอร์ต' : alreadyWatching ? 'เฝ้าดูแล้ว' : '+ Watchlist'}</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selectedItem && (
            <div className="mt-4 rounded-xl border border-gray-700 bg-gray-950/60 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2"><h2 className="text-lg font-bold text-white">{selectedItem.symbol}</h2><span className={`rounded border px-2 py-1 text-xs ${setupStyle(selectedItem.setup)}`}>{setupLabel(selectedItem.setup)}</span>{selectedItem.athStatus === 'ATH' && <span className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-xs text-yellow-300">🏆 ATH</span>}{selectedItem.athStatus === 'NEAR_ATH' && <span className="rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-xs text-green-400">ใกล้ ATH</span>}</div>
                  <p className="mt-1 text-xs text-gray-400">Score {selectedItem.score}/100 · {selectedItem.label}</p>
                </div>
                <button type="button" onClick={() => setSelectedItem(null)} className="text-sm text-gray-400 hover:text-gray-200">✕ ปิด</button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-400">Trend</p><p className="mt-1 font-semibold text-gray-200">{trendLabel(selectedItem.trend)}</p><p className="text-xs text-gray-400">EMA50 {fmtPrice(selectedItem.ema50)} · EMA200 {fmtPrice(selectedItem.ema200)}</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-400">Momentum</p><p className="mt-1 font-semibold text-gray-200">RSI {selectedItem.rsi14?.toFixed(1) ?? '—'} / W {selectedItem.weeklyRsi14?.toFixed(1) ?? '—'}</p><p className="text-xs text-gray-400">MACD Hist {selectedItem.macdHistogram?.toFixed(2) ?? '—'}</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-400">Volume</p><p className="mt-1 font-semibold text-gray-200">{selectedItem.volumeRatio === null ? '—' : `${selectedItem.volumeRatio.toFixed(2)}x`}</p><p className="text-xs text-gray-400">เทียบค่าเฉลี่ย 20 วันก่อนหน้า</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-400">Relative Strength</p><p className="mt-1 font-semibold text-gray-200">20D {fmtPct(selectedItem.relativeStrength20)}</p><p className="text-xs text-gray-400">60D {fmtPct(selectedItem.relativeStrength60)}</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-400">Price Location</p><p className="mt-1 font-semibold text-gray-200">S {fmtPrice(selectedItem.support)}</p><p className="text-xs text-gray-400">R {fmtPrice(selectedItem.resistance)} · 52W {fmtPrice(selectedItem.week52High)}</p><p className="text-xs text-cyan-400">แนวรับสำคัญ {fmtPrice(selectedItem.importantSupport)} · {importantSupportLabel(selectedItem)}{selectedItem.importantSupportTouches > 0 ? ` · ${selectedItem.importantSupportTouches} touches` : ''}</p><p className={`text-xs ${athStatusStyle(selectedItem)}`}>ATH {fmtPrice(selectedItem.allTimeHigh)} · {athStatusLabel(selectedItem)}</p></div>
                <div className="rounded-lg bg-gray-900 p-3"><p className="text-[10px] uppercase text-gray-400">Risk / Catalyst</p><p className="mt-1 font-semibold text-gray-200">R:R {fmtRatio(selectedItem.riskReward)}</p><p className={`text-xs ${selectedItem.earnings && selectedItem.earnings.daysUntil <= 7 ? 'text-orange-400' : 'text-gray-400'}`}>Earnings {earningsLabel(selectedItem)}</p></div>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-400">เหตุผลสำคัญ</p>
                  <ul className="space-y-1 text-xs leading-relaxed text-gray-400">{selectedItem.reasons.map(reason => <li key={reason}>• {reason}</li>)}</ul>
                </div>
                <div className="grid min-w-[240px] grid-cols-2 gap-1.5 text-[11px]">
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">Trend {selectedItem.categoryScores.trend}/25</span>
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">Momentum {selectedItem.categoryScores.momentum}/20</span>
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">Volume {selectedItem.categoryScores.volume}/15</span>
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">Location {selectedItem.categoryScores.priceLocation}/15</span>
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">RS {selectedItem.categoryScores.relativeStrength}/15</span>
                  <span className="rounded bg-gray-900 px-2 py-1.5 text-gray-400">Risk {selectedItem.categoryScores.riskCatalyst}/10</span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
            <form onSubmit={handleSubmit} className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/50 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs text-gray-400">Ticker
                <input aria-label="Watchlist ticker" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="เช่น AMD" maxLength={15} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-semibold uppercase text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
              </label>
              <label className="text-xs text-gray-400">ราคาเป้าหมาย
                <input aria-label="ราคาเป้าหมาย" type="number" min="0.0001" step="0.0001" value={targetPrice} onChange={e => setTargetPrice(e.target.value)} placeholder="USD" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
              </label>
              <label className="text-xs text-gray-400">Collection
                <select aria-label="Watchlist Collection" value={selectedCollection} onChange={e => setSelectedCollection(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  <option value="">ไม่จัดหมวด</option>{collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-400">หมายเหตุ
                <input aria-label="Watchlist note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="เหตุผลหรือแผนที่ต้องการติดตาม" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300 sm:col-span-2 xl:col-span-3">
                <input type="checkbox" checked={alertEnabled} onChange={e => setAlertEnabled(e.target.checked)} className="h-4 w-4 accent-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
                แจ้งเตือนเมื่อราคาถึงหรือต่ำกว่าเป้าหมาย
              </label>
              <button type="submit" disabled={!symbol.trim() || savingSymbol !== null} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50">บันทึกหุ้น</button>
            </form>

            <form onSubmit={createCollection} className="space-y-3 rounded-xl border border-gray-800 bg-gray-950/50 p-4">
              <h2 className="font-semibold text-white">Collections ของพอร์ตนี้</h2>
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="watchlist-collection-name">ชื่อ Collection ใหม่</label>
                <input id="watchlist-collection-name" value={collectionName} onChange={e => setCollectionName(e.target.value)} maxLength={48} placeholder="เช่น รอแนวรับ" className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
                <button type="submit" disabled={!collectionName.trim()} className="rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50">เพิ่ม</button>
              </div>
              <ul className="space-y-2">
                {collections.map(collection => <li key={collection.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-gray-900 px-2 py-2">
                  {renamingCollectionId === collection.id ? <>
                    <label className="sr-only" htmlFor={`rename-${collection.id}`}>ชื่อใหม่สำหรับ {collection.name}</label>
                    <input id={`rename-${collection.id}`} value={renamingCollectionName} onChange={e => setRenamingCollectionName(e.target.value)} maxLength={48} className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white" />
                    <button type="button" onClick={() => void renameCollection(collection.id)} className="text-xs text-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">บันทึก</button>
                  </> : <>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-300">{collection.name}</span>
                    <button type="button" aria-label={`เปลี่ยนชื่อ ${collection.name}`} onClick={() => { setRenamingCollectionId(collection.id); setRenamingCollectionName(collection.name) }} className="text-xs text-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">เปลี่ยนชื่อ</button>
                  </>}
                  <button type="button" aria-label={`ลบ Collection ${collection.name}; หุ้นจะยังอยู่ใน Watchlist`} onClick={() => void deleteCollection(collection.id)} className="text-xs text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">ลบหมวด</button>
                </li>)}
                {collections.length === 0 && <li className="text-xs text-gray-400">ยังไม่มีหมวดหมู่</li>}
              </ul>
              <p className="text-xs text-gray-400">การลบ Collection จะเอาหมวดออกจากหุ้น แต่ไม่ลบหุ้นออกจาก Watchlist</p>
            </form>
          </div>

          {watchlistError && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">⚠️ {watchlistError}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Watchlist และ Smart Alerts</h2>
              <p className="text-xs text-gray-400">ข้อมูลแยกตามพอร์ตที่เลือก · ไม่มีการตรวจราคาอัตโนมัติหรือส่งคำสั่งซื้อขาย</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="watchlist-filter">กรอง Collection</label>
              <select id="watchlist-filter" value={collectionFilter} onChange={e => setCollectionFilter(e.target.value)} className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <option value="all">ทุก Collection</option><option value="">ไม่จัดหมวด</option>{collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <button type="button" onClick={() => void refreshWatchlistQuotes()} disabled={quoteRefreshing || watchlistLoading || watchlist.length === 0} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50">
                {quoteRefreshing ? 'กำลังอัปเดตราคา…' : 'อัปเดตราคา / ประเมิน Alerts'}
              </button>
            </div>
          </div>
          {watchlistLoading ? <p role="status" className="py-6 text-center text-sm text-gray-400">กำลังโหลด Watchlist...</p>
            : watchlist.length === 0 ? <p className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-400">ยังไม่มีหุ้นในพอร์ตนี้ — เพิ่มหุ้นด้านบนหรือจาก Scanner</p>
              : visibleWatchlist.length === 0 ? <p className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-400">Collection นี้ยังไม่มีหุ้น</p>
                : <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {visibleWatchlist.map(item => {
                    const gap = item.current_price !== null && item.target_price !== null && item.current_price > 0 ? ((item.target_price - item.current_price) / item.current_price) * 100 : null
                    const ladder = supportLadders[item.symbol]
                    return <article key={item.id} className="min-w-0 rounded-xl border border-gray-800 bg-gray-900/40 p-4 text-gray-300">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><h3 className="text-lg font-bold text-white">{item.symbol}{heldSet.has(item.symbol) && <span className="ml-1.5 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-400">ถืออยู่</span>}</h3><p className="truncate text-xs text-gray-400">{collections.find(collection => collection.id === item.collection_id)?.name ?? 'ไม่จัดหมวด'}</p></div>
                        <span role="status" className={`shrink-0 rounded-full px-2 py-1 text-xs ${item.smart_alert?.status === 'triggered' ? 'bg-green-500/15 text-green-400' : item.smart_alert?.status === 'unavailable' ? 'bg-amber-500/15 text-amber-400' : 'bg-gray-800 text-gray-400'}`}>
                          {item.smart_alert?.status === 'triggered' ? 'ถึงเป้าหมาย' : item.smart_alert?.status === 'watching' ? 'เฝ้าราคา' : item.smart_alert?.status === 'unavailable' ? 'ข้อมูลราคาไม่พร้อม' : item.smart_alert?.status === 'disabled' ? 'ปิด Alert' : 'ยังไม่ประเมิน'}
                        </span>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-gray-400">ราคาล่าสุด</dt><dd className="font-medium">{fmtPrice(item.current_price)}</dd></div><div><dt className="text-xs text-gray-400">ราคาเป้าหมาย</dt><dd className="font-medium">{fmtPrice(item.target_price)}</dd></div><div><dt className="text-xs text-gray-400">ส่วนต่างถึงเป้า</dt><dd className={(gap ?? 0) >= 0 ? 'text-green-400' : 'text-orange-400'}>{fmtPct(gap)}</dd></div><div><dt className="text-xs text-gray-400">สถานะ Alert</dt><dd>{item.smart_alert?.reason ?? 'ยังไม่ประเมิน'}</dd></div></dl>
                      <p className="mt-2 text-[11px] text-gray-400">{item.price_observation?.source ? `Source: ${item.price_observation.source}` : 'Source: ยังไม่มีการขอราคา'} · {item.price_observation?.freshness === 'fresh' ? 'ข้อมูลสด' : item.price_observation?.freshness === 'stale' ? 'ราคาเก่า' : item.price_observation?.freshness === 'unknown' ? 'เวลาอ้างอิงไม่ทราบ' : 'ยังไม่มีข้อมูลราคา'}{item.price_observation?.providerTimestamp ? ` · ${new Date(item.price_observation.providerTimestamp).toLocaleString('th-TH')}` : ''}</p>
                      {item.note && <p className="mt-2 break-words text-xs text-gray-400">{item.note}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => editWatchlistItem(item)} className="rounded border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">แก้ไข</button>
                        <button type="button" onClick={() => void loadSupportLadder(item.symbol)} disabled={supportLoading === item.symbol} className="rounded border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{supportLoading === item.symbol ? 'กำลังคำนวณ…' : ladder ? 'ซ่อนแนวรับ/แนวต้าน' : 'ดู Support/Resistance'}</button>
                        <button type="button" disabled={savingSymbol === item.symbol} onClick={() => void removeWatchlistItem(item.symbol)} className="rounded border border-red-500/30 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50">ลบหุ้น</button>
                      </div>
                      {ladder && <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950/50 p-3" aria-label={`แนวรับแนวต้าน ${item.symbol}`}><p className="text-xs font-semibold text-gray-300">Support / Resistance Ladder · {ladder.source ?? 'ไม่ทราบ Source'} · {ladder.freshness === 'fresh' ? 'ข้อมูลสด' : ladder.freshness === 'stale' ? 'ข้อมูลเก่า' : 'เวลาไม่ยืนยัน'}</p><ol className="mt-2 flex flex-wrap gap-2">{ladder.levels.map((level, index) => <li key={`${level.kind}-${index}`} className="rounded bg-gray-800 px-2 py-1 text-xs">{level.kind}: {fmtPrice(level.price)}</li>)}</ol><p className="mt-2 text-[11px] text-gray-400">{ladder.lastBarAt ? `แท่งข้อมูลล่าสุด ${new Date(ladder.lastBarAt).toLocaleDateString('th-TH')}` : 'ไม่พบวันที่ของแท่งข้อมูล'} · {ladder.methodology}</p></div>}
                    </article>
                  })}
                </div>}

          <section className="space-y-4 rounded-xl border border-gray-800 bg-gray-950/50 p-4" aria-labelledby="investment-rules-title">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="investment-rules-title" className="font-semibold text-white">Conditional Investment Rules</h2><p className="mt-1 text-xs text-gray-400">ประเมินแบบ deterministic จากข้อมูลของพอร์ตที่เลือกเท่านั้น · ไม่มีการซื้อขายอัตโนมัติ</p></div><button type="button" onClick={() => void evaluateRules()} disabled={ruleBusy || rulesLoading || rules.length === 0} className="rounded-lg border border-blue-500/40 px-3 py-2 text-sm font-semibold text-blue-300 hover:bg-blue-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50">{ruleBusy ? 'กำลังประเมิน…' : 'ประเมินกฎตามข้อมูลล่าสุด'}</button></div>
            {ruleError && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{ruleError}</p>}
            <form onSubmit={createRule} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <label className="text-xs text-gray-400">ชื่อกฎ<input aria-label="ชื่อกฎการลงทุน" value={ruleName} onChange={e => setRuleName(e.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white" /></label>
              <label className="text-xs text-gray-400">เงื่อนไข<select aria-label="ประเภทกฎการลงทุน" value={ruleType} onChange={e => setRuleType(e.target.value as RuleType)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"><option value="PRICE_AT_OR_BELOW">ราคา ≤ เกณฑ์</option><option value="PRICE_AT_OR_ABOVE">ราคา ≥ เกณฑ์</option><option value="DIME_AT_OR_BELOW">ยอด DIME ≤ เกณฑ์</option><option value="CASH_AT_OR_BELOW">เงินสด ≤ เกณฑ์</option><option value="ALLOCATION_AT_OR_BELOW">สัดส่วนพอร์ตของหุ้น ≤ %</option><option value="POSITION_WEIGHT_AT_OR_ABOVE">น้ำหนักความเสี่ยงของหุ้น ≥ %</option></select></label>
              {['PRICE_AT_OR_BELOW', 'PRICE_AT_OR_ABOVE', 'ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'].includes(ruleType) && <label className="text-xs text-gray-400">Symbol<input aria-label="Symbol ของกฎ" value={ruleSymbol} onChange={e => setRuleSymbol(e.target.value.toUpperCase())} maxLength={15} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm uppercase text-white" /></label>}
              <label className="text-xs text-gray-400">{['ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'].includes(ruleType) ? 'เกณฑ์เปอร์เซ็นต์' : 'เกณฑ์ตามหน่วยของข้อมูล'}<input aria-label="ค่าเกณฑ์กฎ" type="number" min="0.0001" max={['ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'].includes(ruleType) ? 100 : undefined} step="0.0001" value={ruleThreshold} onChange={e => setRuleThreshold(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white" /></label>
              <button type="submit" disabled={ruleBusy || !ruleName.trim() || !ruleThreshold.trim()} className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50">เพิ่มกฎ</button>
            </form>
            <p className="text-xs text-gray-400">การประเมินราคาใช้ Finnhub แบบกดเอง จำกัด 12 symbols ต่อครั้ง; สัดส่วนหุ้นต้องมีราคาของ Holdings ครบและไม่เก่ากว่า 24 ชั่วโมง มิฉะนั้นจะแสดงข้อมูลไม่พร้อม</p>
            {ruleEvaluatedAt && <p role="status" className="text-xs text-gray-400">ประเมินเมื่อ {new Date(ruleEvaluatedAt).toLocaleString('th-TH')}</p>}
            {rulesLoading ? <p role="status" className="text-sm text-gray-400">กำลังโหลดกฎ…</p> : rules.length === 0 ? <p className="text-sm text-gray-400">ยังไม่มีกฎในพอร์ตนี้</p> : <ul className="grid gap-2 md:grid-cols-2">{rules.map(rule => {
              const result = ruleResults.find(item => item.id === rule.id)
              return <li key={rule.id} className="flex min-w-0 items-start gap-3 rounded-lg border border-gray-800 bg-gray-900/60 p-3"><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-gray-200">{rule.name}</p><p className="text-xs text-gray-400">{rule.rule_type.replaceAll('_', ' ')}{rule.symbol ? ` · ${rule.symbol}` : ''} · {rule.threshold}{['ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'].includes(rule.rule_type) ? '%' : ''}</p>{result && <p className={`mt-1 text-xs ${result.status === 'triggered' ? 'text-green-400' : result.status === 'unavailable' ? 'text-amber-400' : 'text-gray-400'}`}>{result.status}: {result.reason}</p>}</div><button type="button" onClick={() => void deleteRule(rule.id)} disabled={ruleBusy} aria-label={`ลบกฎ ${rule.name}`} className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">ลบ</button></li>
            })}</ul>}
            <p className="text-[11px] text-gray-400">Rules ให้ข้อมูลประกอบการตัดสินใจเท่านั้น ไม่ส่งคำสั่ง BUY/SELL และไม่แจ้งเตือนพื้นหลัง</p>
          </section>
        </div>
      )}
    </section>
  )
}
