# 🚀 Deploy Guide — Stock Portfolio Tracker

> อ่านทีละ step ทำตามได้เลย ไม่ต้องกลัวพลาด

---

## ก่อนเริ่ม — Checklist เตรียม Accounts

- [ ] [github.com](https://github.com) — มี account แล้ว
- [ ] [supabase.com](https://supabase.com) — มี account แล้ว
- [ ] [vercel.com](https://vercel.com) — มี account แล้ว (Sign in ด้วย GitHub ได้เลย)
- [ ] [finnhub.io](https://finnhub.io) — API key พร้อม
- [ ] [console.anthropic.com](https://console.anthropic.com) — API key พร้อม

---

## STEP 1 — Supabase: สร้าง Project

1. เปิด [app.supabase.com](https://app.supabase.com) → กด **New project**
2. ตั้งชื่อ: `stock-portfolio`
3. ตั้ง **Database Password** (จดเก็บไว้) → กด **Create new project**
4. รอ ~2 นาที ให้ project พร้อม

---

## STEP 2 — Supabase: รัน SQL Schema

1. ซ้ายมือ → คลิก **SQL Editor**
2. กด **New query**
3. เปิดไฟล์ `supabase/schema.sql` → copy ทั้งหมด → วางใน editor
4. กด **Run** (หรือ Ctrl+Enter)
5. ✅ ต้องเห็น "Success. No rows returned"

---

## STEP 3 — Supabase: สร้าง Users

1. ซ้ายมือ → **Authentication** → **Users**
2. กด **Add user** → **Create new user**

**User 1 (นาย):**
- Email: `nay@yourdomain.com` (หรืออีเมลจริง)
- Password: ตั้งรหัสผ่านแข็งแรง
- กด **Create user**

**User 2 (น้องเจน):**
- ทำซ้ำ — Email: `jen@yourdomain.com`
- กด **Create user**

3. Copy **UUID** ของแต่ละ user (คอลัมน์ ID) — จะใช้ใน Step 4

---

## STEP 4 — Supabase: Seed ข้อมูลหุ้นตั้งต้น

1. เปิดไฟล์ `supabase/seed.sql` ด้วย text editor
2. แก้ไข 3 ค่า:
   ```sql
   v_nay UUID := 'วาง-UUID-ของนาย-ที่นี่';
   v_jen UUID := 'วาง-UUID-ของเจน-ที่นี่';
   v_key TEXT := 'ตั้ง-encryption-key-แข็งแรง-อย่างน้อย-32-ตัวอักษร';
   ```
   > ⚠️ `v_key` ต้องตรงกับ `SUPABASE_ENCRYPTION_KEY` ที่จะตั้งใน .env ด้านล่าง — จดเก็บไว้!

3. Copy ไฟล์ seed.sql ที่แก้แล้ว → ไปที่ **SQL Editor** → วาง → **Run**
4. ✅ ต้องเห็น "NOTICE: Seed completed successfully"

---

## STEP 5 — ดึง API Keys จาก Supabase

ไปที่ **Project Settings** (ไอคอนฟันเฟือง ซ้ายล่าง) → **API**

| ค่า | อยู่ที่ไหน |
|-----|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project API Keys → anon/public |
| `SUPABASE_SERVICE_ROLE_KEY` | Project API Keys → service_role ⚠️ secret |

---

## STEP 6 — Setup .env.local (Local Dev)

```bash
# ใน terminal ที่โฟลเดอร์ stock-portfolio
cp .env.local.example .env.local
```

เปิด `.env.local` แล้วใส่ค่าทั้งหมด:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ENCRYPTION_KEY=my-super-secret-key-at-least-32-chars!!
FINNHUB_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-...
```

---

## STEP 7 — ทดสอบ Local ก่อน Deploy

```bash
npm install
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000)

ทดสอบตามลำดับ:
1. Login ด้วย email/password ของนาย → ต้อง redirect ไป `/dashboard`
2. ดูตาราง → ต้องเห็นหุ้น 9 ตัว (ถ้า seed แล้ว)
3. ราคาต้องโหลดจาก Finnhub (ไม่ใช่ `—` ทุกตัว)
4. กด 🤖 AI บน PLTR → ต้องได้ BUY/HOLD/SELL ภาษาไทย
5. กด ✏️ → แก้ไขจำนวนหุ้น → บันทึก → ต้องอัปเดต
6. Logout → กลับไป `/login`
7. Login ด้วย account เจน → ต้องเห็นพอร์ตของเจน (**ไม่เห็น** ข้อมูลของนาย)

---

## STEP 8 — Push ขึ้น GitHub

```bash
cd stock-portfolio

# Init git
git init
git add .
git commit -m "feat: stock portfolio tracker"

# สร้าง repo ใหม่บน github.com ก่อน (กด New repository)
# ชื่อ: stock-portfolio, Private ✅
git remote add origin https://github.com/YOUR_USERNAME/stock-portfolio.git
git branch -M main
git push -u origin main
```

> ✅ ตรวจสอบว่า `.env.local` **ไม่อยู่** ใน commit (มีใน .gitignore แล้ว)

---

## STEP 9 — Deploy บน Vercel

1. เปิด [vercel.com](https://vercel.com) → **Add New Project**
2. กด **Import Git Repository** → เลือก `stock-portfolio`
3. กด **Import**
4. หน้า Configure Project:
   - Framework Preset: **Next.js** (auto-detect)
   - Root Directory: `.` (default)
   - **ยังไม่ต้องกด Deploy**

5. เลื่อนลงมา → **Environment Variables** → เพิ่มทีละตัว:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | จาก Step 5 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | จาก Step 5 |
| `SUPABASE_SERVICE_ROLE_KEY` | จาก Step 5 |
| `SUPABASE_ENCRYPTION_KEY` | key เดียวกับใน seed.sql |
| `FINNHUB_API_KEY` | จาก finnhub.io |
| `ANTHROPIC_API_KEY` | จาก Anthropic Console |

6. กด **Deploy** → รอ ~2 นาที
7. ✅ เห็น "Congratulations!" → กด **Visit** เพื่อเปิดเว็บ

---

## STEP 10 — ตั้งค่า Supabase Auth URL (สำคัญมาก!)

หลัง deploy แล้วได้ URL เช่น `https://stock-portfolio-xxx.vercel.app`

ไปที่ Supabase → **Authentication** → **URL Configuration**:
- **Site URL**: `https://stock-portfolio-xxx.vercel.app`
- **Redirect URLs**: เพิ่ม `https://stock-portfolio-xxx.vercel.app/**`
- กด **Save**

> ถ้าไม่ทำขั้นตอนนี้ — Auth จะ error เมื่อ login บน production

---

## STEP 11 — ทดสอบ Production

เปิด URL จาก Vercel แล้วทำซ้ำ Step 7 บน production

---

## 🔧 ถ้าเจอปัญหา

| อาการ | สาเหตุ | วิธีแก้ |
|-------|--------|---------|
| Login แล้ว redirect วนลูป | Site URL ใน Supabase ผิด | ทำ Step 10 |
| ราคาขึ้นทั้งหมดเป็น `—` | FINNHUB_API_KEY ผิด | ตรวจสอบ key ใน Vercel env |
| ไม่เห็นหุ้นหลัง login | seed.sql ยังไม่ได้รัน หรือ UUID ผิด | รัน seed.sql ใหม่ |
| วิเคราะห์ AI ไม่ทำงาน | ANTHROPIC_API_KEY ผิด/หมด credit | ตรวจสอบ key |
| Build error บน Vercel | ดู Vercel Build Logs | แจ้ง error มาได้เลย |
| cost_basis ขึ้น `—` ทุกตัว | SUPABASE_ENCRYPTION_KEY ไม่ตรงกับที่ใช้ seed | ต้องใช้ key เดิมเท่านั้น |
