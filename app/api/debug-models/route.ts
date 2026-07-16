import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = process.env.GEMINI_API_KEY
  if (!key) return NextResponse.json({ error: 'No API key' })

  // List available models
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    { cache: 'no-store' }
  )
  const data = await res.json()
  
  const models = data.models?.map((m: { name: string; supportedGenerationMethods?: string[] }) => ({
    name: m.name,
    canGenerate: m.supportedGenerationMethods?.includes('generateContent'),
  })).filter((m: { canGenerate: boolean }) => m.canGenerate) ?? []

  return NextResponse.json({ models })
}
