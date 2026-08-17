-- ============================================================
-- Migration Batch 1 (v1.9.1): รันไฟล์นี้ไฟล์เดียวบน DB ที่ใช้งานจริงอยู่ตอนนี้
-- (DB ปัจจุบันรัน migration_rpc_hardening.sql เวอร์ชันเก่าไปแล้ว — มี upsert_holding
--  แบบ 6 parameters + daily_analyses มี policy insert เปิดอยู่ ไฟล์นี้ปิดทั้ง 2 จุด)
--
-- แก้ 2 ประเด็นเท่านั้น ตามที่ตกลงไว้:
-- 1) ปิดช่อง forge daily_analyses — DROP policy ที่อนุญาตให้ authenticated INSERT เอง
--    การเขียนข้อมูลยังทำได้ปกติผ่าน cron ที่ใช้ service_role (bypass RLS อยู่แล้ว ไม่กระทบ)
-- 2) แก้บั๊ก "ลบ notes ไม่ได้" — เพิ่ม p_notes_provided ให้ upsert_holding แยกแยะ
--    "ไม่ได้ส่ง notes มา" (คงค่าเดิม) ออกจาก "ตั้งใจส่งเป็นค่าว่าง/null" (ลบค่าเดิม)
--    เดิมใช้ COALESCE(EXCLUDED.notes, old_notes) ซึ่งแยก 2 กรณีนี้ไม่ได้เพราะเป็น SQL NULL เหมือนกัน
-- ============================================================

-- ---- (1) ปิดช่อง forge daily_analyses ----
DROP POLICY IF EXISTS "daily_analyses_insert_own" ON public.daily_analyses;
-- SELECT policy เดิมไม่แตะ ยังอ่านได้เฉพาะของตัวเองเหมือนเดิม
-- ไม่ต้อง GRANT อะไรเพิ่มให้ service_role เพราะ service_role bypass RLS อยู่แล้วโดย default

-- ---- (2) แก้บั๊กลบ notes ไม่ได้: DROP signature เดิม (6 args) แล้วสร้างใหม่ (7 args) ----
DROP FUNCTION IF EXISTS public.upsert_holding(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT);

CREATE FUNCTION public.upsert_holding(
  p_user_id        UUID,
  p_symbol         TEXT,
  p_shares         NUMERIC,
  p_cost_basis     NUMERIC,   -- NULL = ไม่มีต้นทุน
  p_enc_key        TEXT,
  p_notes          TEXT DEFAULT NULL,
  p_notes_provided BOOLEAN DEFAULT FALSE  -- false = ไม่แตะ notes เดิม, true = ใช้ p_notes ตรงๆ (NULL ก็ลบได้)
)
RETURNS public.holdings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
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
  VALUES (
    p_user_id, UPPER(p_symbol), p_shares, v_enc,
    CASE WHEN p_notes_provided THEN p_notes ELSE NULL END
  )
  ON CONFLICT (user_id, symbol) DO UPDATE SET
    shares         = EXCLUDED.shares,
    cost_basis_enc = EXCLUDED.cost_basis_enc,
    notes          = CASE WHEN p_notes_provided THEN p_notes ELSE public.holdings.notes END,
    updated_at     = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---- (3) ปิดสิทธิ์ execute ของฟังก์ชันใหม่เหมือนเดิม (signature เปลี่ยน ต้อง REVOKE/GRANT ใหม่) ----
REVOKE ALL ON FUNCTION public.upsert_holding(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_holding(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN) TO service_role;
-- get_decrypted_holdings ไม่เปลี่ยน signature รอบนี้ ไม่ต้องแตะ REVOKE/GRANT เดิม

NOTIFY pgrst, 'reload schema';
