-- ============================================================
-- Seed Holdings - รันหลังจาก signup users ทั้ง 2 คนแล้ว
-- วิธีใช้:
--   1. ไปที่ Supabase Dashboard > Authentication > Users
--   2. Copy UUID ของแต่ละ user มาใส่ด้านล่าง
--   3. รัน SQL นี้ใน SQL Editor (ใช้ service_role)
-- ============================================================

DO $$
DECLARE
  v_nay UUID := 'REPLACE_WITH_NAY_USER_UUID';
  v_jen UUID := 'REPLACE_WITH_JEN_USER_UUID';
  v_key TEXT := 'REPLACE_WITH_YOUR_ENCRYPTION_KEY';  -- ตรงกับ SUPABASE_ENCRYPTION_KEY ใน .env
BEGIN
  -- ===== พอร์ตของ นาย =====
  -- shares = 0 เพราะยังไม่รู้จำนวนหุ้น (อัปเดตในแอปทีหลัง)
  PERFORM public.upsert_holding(v_nay, 'NOW',  0, 108.23, v_key);
  PERFORM public.upsert_holding(v_nay, 'PLTR', 0, 139.65, v_key);
  PERFORM public.upsert_holding(v_nay, 'ORCL', 0, 150.31, v_key);
  PERFORM public.upsert_holding(v_nay, 'META', 0, 623.75, v_key);
  PERFORM public.upsert_holding(v_nay, 'RBRK', 0, 57.97,  v_key);
  PERFORM public.upsert_holding(v_nay, 'SOFI', 0, 17.20,  v_key);
  PERFORM public.upsert_holding(v_nay, 'TEM',  0, 48.37,  v_key);
  PERFORM public.upsert_holding(v_nay, 'NVO',  0, 60.15,  v_key);
  -- SPCX ไม่มีต้นทุน (cost_basis = NULL)
  INSERT INTO public.holdings (user_id, symbol, shares)
  VALUES (v_nay, 'SPCX', 0)
  ON CONFLICT (user_id, symbol) DO NOTHING;

  -- ===== พอร์ตของ น้องเจน =====
  -- เพิ่มหุ้นสำหรับเจนได้ที่นี่

  RAISE NOTICE 'Seed completed successfully';
END $$;
