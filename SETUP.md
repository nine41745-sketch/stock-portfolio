# Stock Portfolio Tracker — Setup Guide

## Stack
- **Next.js 14** (App Router) — Frontend + API Routes
- **Supabase** — Auth + PostgreSQL + pgcrypto (encrypted cost_basis)
- **Finnhub** — Real-time US stock prices
- **Claude AI** — BUY/HOLD/SELL analysis
- **Vercel** — Deploy

---

## 1. สร้าง Supabase Project

1. ไปที่ [supabase.com](https://supabase.com) → สร้าง project ใหม่
2. เปิด **SQL Editor** → วาง `supabase/schema.sql` → **Run**

---

## 2. สร้าง Users

ไปที่ **Authentication → Users → Add user** (invite mode)

| User | Email | Password |
|------|-------|----------|
| นาย | nay@example.com | your_password |
| น้องเจน | jen@example.com | your_password |

---

## 3. Seed ข้อมูลหุ้นเริ่มต้น

1. Copy UUID ของแต่ละ user จาก Authentication → Users
2. แก้ไข `supabase/seed.sql` — ใส่ UUID + encryption key
3. รันใน SQL Editor

---

## 4. ดึง API Keys

| Key | ที่มา |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → anon/public |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role (secret) |
| `FINNHUB_API_KEY` | [finnhub.io](https://finnhub.io) → สมัครฟรี |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |

---

## 5. Setup Local

```bash
# Clone / copy โฟลเดอร์ stock-portfolio
cd stock-portfolio

# Copy env
cp .env.local.example .env.local
# แก้ไขค่าทุกตัวใน .env.local

# Install dependencies
npm install

# Run dev server
npm run dev
# เปิด http://localhost:3000
```

---

## 6. Deploy บน Vercel

```bash
# Push ขึ้น GitHub ก่อน
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/stock-portfolio.git
git push -u origin main
```

จากนั้น:
1. ไปที่ [vercel.com](https://vercel.com) → **Add New Project** → Import จาก GitHub
2. ไปที่ **Settings → Environment Variables** → เพิ่มทุกตัวจาก `.env.local`
3. กด **Deploy**

> ⚠️ **สำคัญ:** `SUPABASE_SERVICE_ROLE_KEY` และ `SUPABASE_ENCRYPTION_KEY` เป็น secret — ห้าม commit ลง Git

---

## Architecture ที่น่ารู้

```
Browser (Client)
    │
    ├── /login          → Supabase Auth (email/password)
    │
    └── /dashboard      → Server Component
            │
            ├── createServiceClient()   → get_decrypted_holdings() [pgp_sym_decrypt]
            ├── getMultipleQuotes()     → Finnhub API (cache 60s)
            └── <PortfolioDashboard>   → Client Component
                    │
                    ├── /api/holdings       → CRUD (upsert_holding → pgp_sym_encrypt)
                    ├── /api/prices         → Finnhub real-time refresh
                    └── /api/analyze        → Claude AI (BUY/HOLD/SELL)
```

### Security
- **RLS** ล็อกทุก table — anon key ก็ยังเห็นแค่ข้อมูลตัวเอง
- **cost_basis** encrypt ด้วย `pgp_sym_encrypt` ใน Postgres
- การ decrypt ทำฝั่ง server เท่านั้น ผ่าน service_role
- `SUPABASE_ENCRYPTION_KEY` ไม่เคยส่งไป client

---

## โครงสร้างไฟล์

```
stock-portfolio/
├── app/
│   ├── api/
│   │   ├── analyze/route.ts       ← Claude AI analysis
│   │   ├── holdings/
│   │   │   ├── route.ts           ← POST (create), GET
│   │   │   └── [id]/route.ts      ← PUT (update), DELETE
│   │   └── prices/route.ts        ← Finnhub price fetch
│   ├── dashboard/page.tsx         ← Server Component (SSR + decrypt)
│   ├── login/page.tsx
│   └── layout.tsx
├── components/
│   ├── auth/LoginForm.tsx
│   └── portfolio/
│       ├── PortfolioDashboard.tsx  ← Client Component หลัก
│       └── HoldingModal.tsx        ← Add/Edit/Delete modal
├── lib/
│   ├── claude.ts                  ← Anthropic SDK
│   ├── finnhub.ts                 ← Finnhub API
│   └── supabase/
│       ├── client.ts              ← Browser client
│       └── server.ts              ← Server + Service Role client
├── supabase/
│   ├── schema.sql                 ← Tables, RLS, pgcrypto functions
│   └── seed.sql                   ← Seed holdings ตั้งต้น
├── types/index.ts
├── middleware.ts                  ← Auth guard + session refresh
└── SETUP.md
```
