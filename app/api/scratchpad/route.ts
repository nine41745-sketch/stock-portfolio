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
    .select('content, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[scratchpad:GET] query failed:', error)
    return NextResponse.json({ error: 'โหลดโน้ตไม่สำเร็จ' }, { status: 500 })
  }

  return NextResponse.json({ content: data?.content ?? '', revision: data?.updated_at ?? null, userId: user.id }, { headers: { 'Cache-Control': 'no-store' } })
}

// PUT /api/scratchpad — revision-guarded insert/update after client debounce.
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

  // Fail closed for older/cached clients; no caller may bypass compare-and-swap.
  // Keep their draft in the browser and ask them to copy it before refreshing.
  if (!Object.prototype.hasOwnProperty.call(body, 'expectedRevision')) {
    return NextResponse.json({ error: 'ต้องโหลด Revision ก่อนบันทึก กรุณาคัดลอกข้อความไว้แล้วโหลดหน้าใหม่' }, { status: 428 })
  }
  if (body.userId !== user.id) return NextResponse.json({ error: 'Session changed' }, { status: 403 })
  if (body.expectedRevision !== null && (typeof body.expectedRevision !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(body.expectedRevision)
    || !Number.isFinite(Date.parse(body.expectedRevision)))) {
    return NextResponse.json({ error: 'Invalid revision' }, { status: 400 })
  }
  const row = { user_id: user.id, content: body.content, updated_at: new Date().toISOString() }
  const result = body.expectedRevision === null
    ? await supabase.from('scratchpad_notes').insert(row).select('updated_at').maybeSingle()
    : await supabase.from('scratchpad_notes').update(row).eq('user_id', user.id)
      .eq('updated_at', body.expectedRevision).select('updated_at').maybeSingle()
  if (result.error?.code === '23505' || (!result.error && !result.data)) {
    return NextResponse.json({ error: 'โน้ตมีการเปลี่ยนแปลงจากหน้าต่างอื่น กรุณาคัดลอกข้อความไว้แล้วเปิดหน้าใหม่' }, { status: 409 })
  }
  if (result.error) return NextResponse.json({ error: 'บันทึกโน้ตไม่สำเร็จ' }, { status: 500 })
  return NextResponse.json({ ok: true, revision: result.data!.updated_at })
}
