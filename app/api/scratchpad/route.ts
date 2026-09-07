import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_SCRATCHPAD_LENGTH = 50_000

// GET /api/scratchpad — ดึงโน้ตส่วนตัวของ user (Quick Notes / Scratchpad Drawer)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('scratchpad_notes')
    .select('content')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[scratchpad:GET] query failed:', error)
    return NextResponse.json({ error: 'โหลดโน้ตไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({ content: data?.content ?? '' })
}

// PUT /api/scratchpad — บันทึกโน้ต (upsert, เรียกแบบ debounce จากฝั่ง client หลังหยุดพิมพ์)
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'content') || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'content ต้องเป็นข้อความ' }, { status: 400 })
  }
  if (body.content.length > MAX_SCRATCHPAD_LENGTH) {
    return NextResponse.json({ error: `โน้ตยาวเกิน ${MAX_SCRATCHPAD_LENGTH.toLocaleString('en-US')} ตัวอักษร` }, { status: 400 })
  }

  const { error } = await supabase
    .from('scratchpad_notes')
    .upsert({ user_id: user.id, content: body.content, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

  if (error) {
    console.error('[scratchpad:PUT] upsert failed:', error)
    return NextResponse.json({ error: 'บันทึกโน้ตไม่สำเร็จ' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
