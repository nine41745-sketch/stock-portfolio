-- ============================================================
-- Stock Portfolio Tracker - Supabase Schema
-- ============================================================

-- Enable pgcrypto for symmetric encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- TABLE: holdings
-- cost_basis เก็บแบบ encrypted ด้วย pgp_sym_encrypt
-- ============================================================
CREATE TABLE IF NOT EXISTS public.holdings (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol        TEXT        NOT NULL,
  shares        NUMERIC(15,6) NOT NULL DEFAULT 0,
  cost_basis_enc TEXT       NULL,  -- pgp_sym_encrypt(cost_basis::text, key)
  notes         TEXT        NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, symbol)
);

-- ============================================================
-- Row Level Security: แต่ละ user เห็นแค่ข้อมูลตัวเอง
-- ============================================================
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holdings_select_own"
  ON public.holdings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "holdings_insert_own"
  ON public.holdings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "holdings_update_own"
  ON public.holdings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "holdings_delete_own"
  ON public.holdings FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- TABLE: price_cache  (optional - cache ราคาไม่ให้ hit Finnhub บ่อยเกินไป)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.price_cache (
  symbol      TEXT        PRIMARY KEY,
  price       NUMERIC(15,4) NOT NULL,
  cached_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- price_cache อ่านได้ทุกคน (ราคาไม่ sensitive), write ผ่าน service_role เท่านั้น
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "price_cache_read_all"
  ON public.price_cache FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- FUNCTION: update_updated_at()
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER holdings_updated_at
  BEFORE UPDATE ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- FUNCTION: upsert_holding (server-side encryption helper)
-- รับ cost_basis เป็น plaintext, encrypt ด้วย key ที่ส่งมา
-- เรียกจาก server-side เท่านั้น (service_role)
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_holding(
  p_user_id   UUID,
  p_symbol    TEXT,
  p_shares    NUMERIC,
  p_cost_basis NUMERIC,
  p_enc_key   TEXT
)
RETURNS public.holdings LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row public.holdings;
BEGIN
  INSERT INTO public.holdings (user_id, symbol, shares, cost_basis_enc)
  VALUES (
    p_user_id,
    UPPER(p_symbol),
    p_shares,
    pgp_sym_encrypt(p_cost_basis::TEXT, p_enc_key)
  )
  ON CONFLICT (user_id, symbol) DO UPDATE SET
    shares        = EXCLUDED.shares,
    cost_basis_enc = EXCLUDED.cost_basis_enc,
    updated_at    = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ============================================================
-- FUNCTION: get_decrypted_holdings (server-side decrypt)
-- เรียกจาก server เท่านั้น — ส่ง enc_key ผ่าน parameter
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_decrypted_holdings(
  p_user_id UUID,
  p_enc_key TEXT
)
RETURNS TABLE (
  id            UUID,
  symbol        TEXT,
  shares        NUMERIC,
  cost_basis    NUMERIC,
  notes         TEXT,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    h.id,
    h.symbol,
    h.shares,
    CASE
      WHEN h.cost_basis_enc IS NOT NULL
      THEN pgp_sym_decrypt(h.cost_basis_enc::BYTEA, p_enc_key)::NUMERIC
      ELSE NULL
    END AS cost_basis,
    h.notes,
    h.created_at,
    h.updated_at
  FROM public.holdings h
  WHERE h.user_id = p_user_id
  ORDER BY h.symbol;
END;
$$;

-- ============================================================
-- SEED DATA
-- หมายเหตุ: สร้าง users ผ่าน Supabase Auth Dashboard ก่อน
-- แล้ว copy UUID มาใส่ในคำสั่ง INSERT ด้านล่าง
-- หรือใช้ script seed แยก (seed.sql) หลัง signup แล้ว
-- ============================================================

-- ตัวอย่าง seed (แทน USER_UUID_NAY และ USER_UUID_JEN ด้วย UUID จริง)
/*
DO $$
DECLARE
  v_nay UUID := 'USER_UUID_NAY';   -- UUID ของ นาย
  v_jen UUID := 'USER_UUID_JEN';   -- UUID ของ น้องเจน
  v_key TEXT := current_setting('app.encryption_key');
BEGIN
  -- พอร์ตของ นาย
  PERFORM public.upsert_holding(v_nay, 'NOW',  0, 108.23, v_key);
  PERFORM public.upsert_holding(v_nay, 'PLTR', 0, 139.65, v_key);
  PERFORM public.upsert_holding(v_nay, 'ORCL', 0, 150.31, v_key);
  PERFORM public.upsert_holding(v_nay, 'META', 0, 623.75, v_key);
  PERFORM public.upsert_holding(v_nay, 'RBRK', 0, 57.97,  v_key);
  PERFORM public.upsert_holding(v_nay, 'SOFI', 0, 17.20,  v_key);
  PERFORM public.upsert_holding(v_nay, 'TEM',  0, 48.37,  v_key);
  PERFORM public.upsert_holding(v_nay, 'NVO',  0, 60.15,  v_key);
  PERFORM public.upsert_holding(v_nay, 'SPCX', 0, NULL,   v_key);  -- ไม่มีต้นทุน
END $$;
*/

-- ============================================================
-- FUNCTION: upsert_holding_nullable (รองรับ cost_basis = NULL)
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_holding(
  p_user_id    UUID,
  p_symbol     TEXT,
  p_shares     NUMERIC,
  p_cost_basis NUMERIC,   -- NULL = ไม่มีต้นทุน
  p_enc_key    TEXT
)
RETURNS public.holdings LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row public.holdings;
  v_enc TEXT;
BEGIN
  -- Encrypt ถ้ามี cost_basis
  IF p_cost_basis IS NOT NULL THEN
    v_enc := pgp_sym_encrypt(p_cost_basis::TEXT, p_enc_key);
  ELSE
    v_enc := NULL;
  END IF;

  INSERT INTO public.holdings (user_id, symbol, shares, cost_basis_enc)
  VALUES (p_user_id, UPPER(p_symbol), p_shares, v_enc)
  ON CONFLICT (user_id, symbol) DO UPDATE SET
    shares         = EXCLUDED.shares,
    cost_basis_enc = EXCLUDED.cost_basis_enc,
    updated_at     = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
