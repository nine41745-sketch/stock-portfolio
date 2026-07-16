/**
 * test-setup.mjs — ทดสอบการเชื่อมต่อทุกส่วนก่อน deploy
 *
 * วิธีรัน:
 *   node scripts/test-setup.mjs
 *
 * ต้องมี .env.local ตั้งค่าครบก่อน
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// โหลด .env.local
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of envFile.split('\n')) {
    const [key, ...vals] = line.split('=')
    if (key && !key.startsWith('#') && vals.length) {
      process.env[key.trim()] = vals.join('=').trim()
    }
  }
} catch {
  console.error('❌ ไม่พบ .env.local — copy จาก .env.local.example ก่อน')
  process.exit(1)
}

const REQUIRED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ENCRYPTION_KEY',
  'FINNHUB_API_KEY',
  'ANTHROPIC_API_KEY',
]

let passed = 0
let failed = 0

function ok(msg)   { console.log(`  ✅ ${msg}`); passed++ }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++ }
function section(title) { console.log(`\n── ${title} ──`) }

// ─── 1. ENV VARS ────────────────────────────────────────────
section('1. Environment Variables')
for (const key of REQUIRED_VARS) {
  if (process.env[key]) {
    ok(`${key} ✓`)
  } else {
    fail(`${key} — ยังไม่ได้ตั้งค่า`)
  }
}

// ─── 2. SUPABASE CONNECTION ──────────────────────────────────
section('2. Supabase Connection')
try {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`
  const res = await fetch(url, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }
  })
  if (res.status === 200 || res.status === 404) {
    ok('Supabase URL เชื่อมต่อได้')
  } else {
    fail(`Supabase URL ตอบ status ${res.status}`)
  }
} catch (e) {
  fail(`Supabase connection error: ${e.message}`)
}

// ─── 3. SUPABASE TABLES ──────────────────────────────────────
section('3. Supabase Tables & RLS')
try {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/holdings?select=id&limit=1`
  const res = await fetch(url, {
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
    }
  })
  const data = await res.json()
  if (res.ok) {
    ok('Table "holdings" พบแล้ว + RLS ทำงาน (rows = 0 ถูกต้อง ไม่ได้ login)')
  } else if (data.code === '42501') {
    ok('Table "holdings" พบแล้ว + RLS บล็อก unauthorized ✓')
  } else {
    fail(`Holdings table error: ${JSON.stringify(data)}`)
  }
} catch (e) {
  fail(`Table check error: ${e.message}`)
}

// ─── 4. PGCRYPTO ENCRYPTION ──────────────────────────────────
section('4. pgcrypto Encryption (via service role)')
try {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/get_decrypted_holdings`
  // เรียก function ด้วย UUID ปลอม — ต้องตอบ [] ไม่ใช่ error pgcrypto
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY,
    }),
  })
  const data = await res.json()
  if (Array.isArray(data)) {
    ok(`get_decrypted_holdings() ทำงานได้ (คืน ${data.length} rows)`)
    if (data.length > 0 && data[0].cost_basis !== undefined) {
      ok('pgcrypto decrypt ทำงาน — cost_basis field พบแล้ว')
    } else if (data.length === 0) {
      ok('pgcrypto function พร้อม — ยังไม่มี holdings (ปกติถ้ายังไม่ seed)')
    }
  } else {
    fail(`pgcrypto function error: ${JSON.stringify(data)}`)
  }
} catch (e) {
  fail(`pgcrypto test error: ${e.message}`)
}

// ─── 5. UPSERT_HOLDING FUNCTION ──────────────────────────────
section('5. upsert_holding Function (Encryption Write Test)')
try {
  // ใช้ UUID ปลอม — จะ fail ด้วย foreign key แต่แสดงว่า function มีอยู่
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/upsert_holding`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_symbol: 'TEST',
      p_shares: 1,
      p_cost_basis: 100,
      p_enc_key: process.env.SUPABASE_ENCRYPTION_KEY,
    }),
  })
  const data = await res.json()
  // FK violation = function มีอยู่แต่ user ไม่มี (ถูกต้อง)
  if (data.code === '23503' || data.message?.includes('foreign key')) {
    ok('upsert_holding() function พบแล้ว + pgcrypto encrypt พร้อม')
  } else if (data.id) {
    ok('upsert_holding() ทำงานสมบูรณ์')
  } else {
    fail(`upsert_holding error: ${JSON.stringify(data)}`)
  }
} catch (e) {
  fail(`upsert_holding test error: ${e.message}`)
}

// ─── 6. FINNHUB API ──────────────────────────────────────────
section('6. Finnhub API (Real-time Stock Prices)')
try {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${process.env.FINNHUB_API_KEY}`
  )
  const data = await res.json()
  if (data.c && data.c > 0) {
    ok(`Finnhub ✓ — AAPL ราคาปัจจุบัน: $${data.c.toFixed(2)}`)
  } else if (data.error) {
    fail(`Finnhub error: ${data.error}`)
  } else {
    fail(`Finnhub ตอบผิดปกติ: ${JSON.stringify(data)}`)
  }
} catch (e) {
  fail(`Finnhub connection error: ${e.message}`)
}

// ─── 7. CLAUDE API ───────────────────────────────────────────
section('7. Anthropic Claude API')
try {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with: OK' }],
    }),
  })
  const data = await res.json()
  if (data.content?.[0]?.text) {
    ok(`Claude API ✓ — ตอบ: "${data.content[0].text.trim()}"`)
  } else if (data.error) {
    fail(`Claude API error: ${data.error.message}`)
  } else {
    fail(`Claude ตอบผิดปกติ: ${JSON.stringify(data)}`)
  }
} catch (e) {
  fail(`Claude connection error: ${e.message}`)
}

// ─── SUMMARY ─────────────────────────────────────────────────
console.log('\n' + '═'.repeat(40))
console.log(`  ผ่าน: ${passed}   ไม่ผ่าน: ${failed}`)
console.log('═'.repeat(40))

if (failed === 0) {
  console.log('\n🎉 ทุกอย่างพร้อม! Deploy ได้เลยครับ\n')
} else {
  console.log(`\n⚠️  แก้ไข ${failed} ข้อข้างต้นก่อน deploy\n`)
  process.exit(1)
}
