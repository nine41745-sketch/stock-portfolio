-- ============================================================
-- Migration: RPC Security Hardening (v1.8.0)
-- แก้ปัญหาที่พบจาก Audit (ChatGPT + Gemini) วันที่ 2026-08-07:
--
-- 1. Critical: upsert_holding / get_decrypted_holdings เป็น SECURITY DEFINER
--    แต่ไม่เคยถูก REVOKE สิทธิ์ execute จาก PUBLIC/anon/authenticated เลย
--    และตัวฟังก์ชันเองก็ไม่เช็คว่า p_user_id ตรงกับ auth.uid() ของผู้เรียก
--    -> user ที่ login แล้วสามารถเรียก RPC ผ่าน Supabase client โดยตรง
--       ใส่ UUID ของ user อื่น แล้วเขียนทับ/อ่าน holdings ของคนอื่นได้
--    แก้โดย: จำกัดสิทธิ์ execute ให้เฉพาะ service_role เท่านั้น (ตรงกับที่แอปเรียกจริงอยู่แล้ว
--    ทุกจุดผ่าน createServiceClient() — เช็คโค้ดแล้วไม่มีจุดไหนเรียกผ่าน client session)
--
-- 2. upsert_holding ถูกประกาศซ้ำ 2 รอบในไฟล์เดียวกัน (schema.sql บรรทัด 83 และ 179)
--    signature เหมือนกันทุกตัว ตัวหลังทับตัวแรกเงียบๆ ตัวแรกกลายเป็นโค้ดขยะ
--    แก้โดย: เหลือฟังก์ชันเดียว รองรับทั้ง cost_basis ปกติและ NULL
--
-- 3. เพิ่ม p_notes ให้ upsert_holding บันทึก shares+cost_basis+notes ใน query เดียว
--    (เดิมต้องยิง update แยกอีกรอบ ถ้ารอบสองพลาด notes จะไม่ถูกบันทึกโดย API ไม่รู้ตัว)
--
-- 4. เพิ่ม SET search_path = pg_catalog, public ให้ SECURITY DEFINER ทุกตัว
--    กัน function/object shadowing attack
--
-- 5. Safety net: สร้างตาราง user_settings + RLS ถ้ายังไม่มี (ChatGPT ตั้งข้อสังเกตว่า
--    ไม่พบ migration ของตารางนี้ในระบบเลย ทั้งที่ /api/user-settings ใช้งานอยู่จริง —
--    ใช้ IF NOT EXISTS ทั้งหมด จึงไม่กระทบข้อมูลเดิมถ้ามีตารางอยู่แล้ว)
-- ============================================================

-- ---- (1) ลบฟังก์ชันเดิมทั้งหมดก่อนสร้างใหม่ (เปลี่ยน signature เพิ่ม p_notes) ----
DROP FUNCTION IF EXISTS public.upsert_holding(UUID, TEXT, NUMERIC, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.get_decrypted_holdings(UUID, TEXT);

-- ---- (2) upsert_holding เวอร์ชันเดียว รองรับ cost_basis = NULL + notes ----
CREATE FUNCTION public.upsert_holding(
  p_user_id    UUID,
  p_symbol     TEXT,
  p_shares     NUMERIC,
  p_cost_basis NUMERIC,   -- NULL = ไม่มีต้นทุน
  p_enc_key    TEXT,
  p_notes      TEXT DEFAULT NULL
)
RETURNS public.holdings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row public.holdings;
  v_enc TEXT;
BEGIN
  IF p_cost_basis IS NOT NULL THEN
    v_enc := pgp_sym_encrypt(p_cost_basis::TEXT, p_enc_key);
  ELSE
    v_enc := NULL;
  END IF;

  INSERT INTO public.holdings (user_id, symbol, shares, cost_basis_enc, notes)
  VALUES (p_user_id, UPPER(p_symbol), p_shares, v_enc, p_notes)
  ON CONFLICT (user_id, symbol) DO UPDATE SET
    shares         = EXCLUDED.shares,
    cost_basis_enc = EXCLUDED.cost_basis_enc,
    notes          = COALESCE(EXCLUDED.notes, public.holdings.notes),
    updated_at     = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---- (3) get_decrypted_holdings ----
CREATE FUNCTION public.get_decrypted_holdings(
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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

-- ---- (4) ปิดช่องโหว่ Critical: จำกัดสิทธิ์ execute เฉพาะ service_role ----
-- (แอปทั้งหมดเรียก 2 ฟังก์ชันนี้ผ่าน createServiceClient() เท่านั้นอยู่แล้ว
--  ไม่มีจุดไหนในโค้ดเรียกผ่าน client-side session — ปลอดภัยที่จะ revoke จาก anon/authenticated)
REVOKE ALL ON FUNCTION public.upsert_holding(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_decrypted_holdings(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_holding(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_decrypted_holdings(UUID, TEXT) TO service_role;

-- ---- (5) Safety net: user_settings table (ถ้ายังไม่เคยมี migration ของตารางนี้) ----
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cash_balance        NUMERIC(15,2) NOT NULL DEFAULT 0,
  dime_balance        NUMERIC(15,2) NOT NULL DEFAULT 0,
  initial_capital     NUMERIC(15,2) NOT NULL DEFAULT 0,
  dime_updated_at     TIMESTAMPTZ,
  capital_updated_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_settings_select_own" ON public.user_settings;
DROP POLICY IF EXISTS "user_settings_insert_own" ON public.user_settings;
DROP POLICY IF EXISTS "user_settings_update_own" ON public.user_settings;

CREATE POLICY "user_settings_select_own"
  ON public.user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_settings_insert_own"
  ON public.user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_settings_update_own"
  ON public.user_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS user_settings_updated_at ON public.user_settings;
CREATE TRIGGER user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

NOTIFY pgrst, 'reload schema';
