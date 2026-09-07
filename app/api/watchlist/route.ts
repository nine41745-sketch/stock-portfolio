import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMultipleQuotes } from '@/lib/finnhub'
import { InputValidationError, parseSymbol } from '@/lib/portfolio-validation'

// Keep quote fan-out bounded because Finnhub free-tier quota is shared with the portfolio dashboard.
const MAX_WATCHLIST_ITEMS = 12
const MAX_NOTE_LENGTH = 500
const MAX_TARGET_PRICE = 99_999_999_999.9999

function parseTargetPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_TARGET_PRICE) {
    throw new InputValidationError('ราคาเป้าหมายไม่ถูกต้อง')
  }
  return Math.round((parsed + Number.EPSILON) * 10_000) / 10_000
}

function parseNote(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new InputValidationError('หมายเหตุต้องเป็นข้อความ')
  const note = value.trim()
  if (!note) return null
  if (note.length > MAX_NOTE_LENGTH) throw new InputValidationError('หมายเหตุยาวเกิน 500 ตัวอักษร')
  return note
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('watchlist')
    .select('id, symbol, target_price, note, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(MAX_WATCHLIST_ITEMS)

  if (error) {
    console.error('[watchlist] GET failed:', error)
    return NextResponse.json({ error: 'โหลด Watchlist ไม่สำเร็จ' }, { status: 500 })
  }

  const rows = data ?? []
  const quotes = rows.length ? await getMultipleQuotes(rows.map(row => row.symbol as string)) : {}

  return NextResponse.json({
    items: rows.map(row => ({
      ...row,
      target_price: row.target_price === null ? null : Number(row.target_price),
      current_price: quotes[row.symbol as string] ?? null,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json() as Record<string, unknown>
    const symbol = parseSymbol(body.symbol)
    const targetPrice = parseTargetPrice(body.target_price)
    const note = parseNote(body.note)

    const [{ data: existing }, { count, error: countError }] = await Promise.all([
      supabase
        .from('watchlist')
        .select('id')
        .eq('user_id', user.id)
        .eq('symbol', symbol)
        .maybeSingle(),
      supabase
        .from('watchlist')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
    ])

    if (countError) {
      console.error('[watchlist] count failed:', countError)
      return NextResponse.json({ error: 'ตรวจสอบ Watchlist ไม่สำเร็จ' }, { status: 500 })
    }
    if (!existing && (count ?? 0) >= MAX_WATCHLIST_ITEMS) {
      return NextResponse.json({ error: `Watchlist รองรับสูงสุด ${MAX_WATCHLIST_ITEMS} ตัว` }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('watchlist')
      .upsert({
        user_id: user.id,
        symbol,
        target_price: targetPrice,
        note,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,symbol' })
      .select('id, symbol, target_price, note, created_at, updated_at')
      .single()

    if (error) {
      console.error('[watchlist] POST failed:', error)
      return NextResponse.json({ error: 'บันทึก Watchlist ไม่สำเร็จ' }, { status: 500 })
    }

    return NextResponse.json({
      item: {
        ...data,
        target_price: data.target_price === null ? null : Number(data.target_price),
      },
    })
  } catch (error) {
    if (error instanceof InputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[watchlist] invalid request:', error)
    return NextResponse.json({ error: 'ข้อมูล Watchlist ไม่ถูกต้อง' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const symbol = parseSymbol(request.nextUrl.searchParams.get('symbol'))
    const { error } = await supabase
      .from('watchlist')
      .delete()
      .eq('user_id', user.id)
      .eq('symbol', symbol)

    if (error) {
      console.error('[watchlist] DELETE failed:', error)
      return NextResponse.json({ error: 'ลบจาก Watchlist ไม่สำเร็จ' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof InputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Symbol ไม่ถูกต้อง' }, { status: 400 })
  }
}
