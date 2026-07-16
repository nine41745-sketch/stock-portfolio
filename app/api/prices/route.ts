import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMultipleQuotes } from '@/lib/finnhub'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const symbols = request.nextUrl.searchParams.get('symbols')?.split(',') ?? []
  if (!symbols.length) {
    return NextResponse.json({ error: 'No symbols provided' }, { status: 400 })
  }

  const prices = await getMultipleQuotes(symbols)
  return NextResponse.json({ prices })
}
