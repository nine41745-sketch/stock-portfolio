-- ============================================================
-- v1.15.0 — Persist latest manual AI analysis without touching daily history
--
-- Goal:
--   - Manual Analyze result survives refresh / PIN lock / full logout.
--   - daily_analyses remains the immutable-ish daily source used by Track Record.
--   - Dashboard chooses whichever result has the newest analysedAt.
--   - Older cached manual results are not allowed to overwrite a newer manual result.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.manual_latest_analyses (
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol       TEXT        NOT NULL,
  result       JSONB       NOT NULL,
  analysed_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_manual_latest_analyses_user_time
  ON public.manual_latest_analyses (user_id, analysed_at DESC);

ALTER TABLE public.manual_latest_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manual_latest_analyses_select_own" ON public.manual_latest_analyses;
CREATE POLICY "manual_latest_analyses_select_own"
  ON public.manual_latest_analyses FOR SELECT
  USING (auth.uid() = user_id);

-- ไม่มี INSERT/UPDATE policy สำหรับ authenticated user โดยตั้งใจ:
-- write ทำผ่าน service_role + RPC เท่านั้น เพื่อกัน client ปลอมผล AI ล่าสุดเอง

CREATE OR REPLACE FUNCTION public.save_latest_manual_analysis(
  p_user_id     UUID,
  p_symbol      TEXT,
  p_result      JSONB,
  p_analysed_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_user_id IS NULL OR p_result IS NULL OR p_analysed_at IS NULL OR BTRIM(COALESCE(p_symbol, '')) = '' THEN
    RAISE EXCEPTION 'invalid latest analysis payload';
  END IF;

  INSERT INTO public.manual_latest_analyses (
    user_id, symbol, result, analysed_at
  ) VALUES (
    p_user_id, UPPER(BTRIM(p_symbol)), p_result, p_analysed_at
  )
  ON CONFLICT (user_id, symbol) DO UPDATE SET
    result      = EXCLUDED.result,
    analysed_at = EXCLUDED.analysed_at,
    updated_at  = NOW()
  -- cached/manual result ที่เก่ากว่าห้ามย้อนทับค่าที่ใหม่กว่า
  WHERE public.manual_latest_analyses.analysed_at <= EXCLUDED.analysed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.save_latest_manual_analysis(UUID, TEXT, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_latest_manual_analysis(UUID, TEXT, JSONB, TIMESTAMPTZ)
  TO service_role;

NOTIFY pgrst, 'reload schema';
