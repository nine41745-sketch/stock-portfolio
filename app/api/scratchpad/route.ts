import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/scratchpad — ดึงโน้ตส่วนตัวของ user (Quick Notes / Scratchpad Drawer)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('scratchpad_notes')
    .select('content')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({ content: data?.content ?? '' })
}

// PUT /api/scratchpad — บันทึกโน้ต (upsert, เรียกแบบ debounce จากฝั่ง client หลังหยุดพิมพ์)
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const content = typeof body.content === 'string' ? body.content : ''

  const { error } = await supabase
    .from('scratchpad_notes')
    .upsert({ user_id: user.id, content, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
