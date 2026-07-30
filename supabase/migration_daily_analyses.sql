-- ============================================================
-- Migration: daily_analyses + track record
-- รันไฟล์นี้ต่อจาก schema.sql เดิม (ผ่าน Supabase SQL Editor)
-- รองรับ:
--   1) ผลวิเคราะห์ AI รายวันจาก Vercel Cron (06:00 ICT / 23:00 UTC วันก่อนหน้า)
--   2) คำนวณ Win Rate ย้อนหลัง 7/30 วัน จากสัญญาณที่เคยแนะนำ vs ราคาจริงที่เกิดขึ้น
-- ============================================================

-- ============================================================
-- TABLE: daily_analyses
-- 1 แถว = 1 หุ้น 1 user 1 วัน (unique constraint กัน cron รันซ้ำสร้างแถวซ้อน)
-- เก็บ JSONB ทั้งก้อนของ DetailedAnalysisResult ไว้โชว์ dashboard แบบ instant-load
-- แยก action + price_at_analysis ออกมาเป็นคอลัมน์จริงด้วย เพื่อ query/aggregate สำหรับ
-- track record ได้เร็ว โดยไม่ต้องแกะ JSONB ทุกครั้ง
-- ============================================================
CREATE TABLE IF NOT EXISTS public.daily_analyses (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol            TEXT        NOT NULL,
  analysis_date     DATE        NOT NULL,   -- วันที่ (ตามเวลาไทย) ที่ cron รัน — natural key รายวัน
  price_at_analysis NUMERIC(15,4),          -- ราคาที่ใช้วิเคราะห์วันนั้น (สำหรับเทียบ track record ภายหลัง)
  action            TEXT        NOT NULL CHECK (action IN ('BUY','HOLD','SELL_PARTIAL','SELL_ALL')),
  result            JSONB       NOT NULL,   -- DetailedAnalysisResult ทั้งก้อน (technicalSummary, risks, usedNews, technical snapshot ฯลฯ)
  used_model        TEXT,                   -- 'llama-3.3-70b-versatile' | 'llama-3.1-8b-instant'
  error             TEXT,                   -- 'RATE_LIMIT' | 'FAILED' | NULL = วิเคราะห์สำเร็จ
  created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (user_id, symbol, analysis_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_analyses_lookup
  ON public.daily_analyses (user_id, symbol, analysis_date DESC);

-- RLS: อ่านได้เฉพาะของตัวเอง เขียนผ่าน cron ด้วย service_role (bypass RLS อยู่แล้ว)
-- ใส่ policy insert ไว้เผื่ออนาคตอยากให้ client เขียนตรงได้ (เช่น ปุ่ม "วิเคราะห์ซ้ำ" ที่ยังไม่รอ cron)
ALTER TABLE public.daily_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_analyses_select_own" ON public.daily_analyses;
CREATE POLICY "daily_analyses_select_own"
  ON public.daily_analyses FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "daily_analyses_insert_own" ON public.daily_analyses;
CREATE POLICY "daily_analyses_insert_own"
  ON public.daily_analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- FUNCTION: get_track_record
-- เทียบ action ที่เคยแนะนำไว้ p_days วันก่อน กับราคาจริงที่เกิดขึ้นจริงตอนนี้
-- ใช้ fuzzy match หาแถววันที่ใกล้เคียงที่สุด (+/- 2 วัน) แทน exact match
-- กันกรณี cron พลาดรันบางวัน (เช่น deploy ล่ม, ตลาดปิดวันหยุดพิเศษ) ไม่ให้ track record เพี้ยน
--
-- เกณฑ์ "ถูก/ผิด" (is_correct) — เป็นเกณฑ์เริ่มต้นที่ปรับได้ภายหลัง:
--   BUY          ถูก ถ้าราคาขึ้น
--   SELL_ALL/PARTIAL ถูก ถ้าราคาลง (ยืนยันว่าตัดสินใจขาย/ลดพอร์ตถูกจังหวะ)
--   HOLD         ถูก ถ้าราคาไม่ขยับเกิน +/-5% (แปลว่าไม่ควรทำอะไรจริงๆ)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_track_record(p_user_id UUID, p_days INT)
RETURNS TABLE (
  symbol            TEXT,
  analysis_date     DATE,
  action            TEXT,
  price_at_analysis NUMERIC,
  price_now         NUMERIC,
  evaluated_date    DATE,
  pct_change        NUMERIC,
  is_correct        BOOLEAN
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    past.symbol,
    past.analysis_date,
    past.action,
    past.price_at_analysis,
    later.price_at_analysis AS price_now,
    later.analysis_date     AS evaluated_date,
    ROUND(
      ((later.price_at_analysis - past.price_at_analysis) / NULLIF(past.price_at_analysis, 0)) * 100
    , 2) AS pct_change,
    CASE
      WHEN past.action = 'BUY'
        AND later.price_at_analysis > past.price_at_analysis THEN TRUE
      WHEN past.action IN ('SELL_ALL', 'SELL_PARTIAL')
        AND later.price_at_analysis < past.price_at_analysis THEN TRUE
      WHEN past.action = 'HOLD'
        AND ABS((later.price_at_analysis - past.price_at_analysis) / NULLIF(past.price_at_analysis, 0)) <= 0.05 THEN TRUE
      ELSE FALSE
    END AS is_correct
  FROM public.daily_analyses past
  CROSS JOIN LATERAL (
    SELECT da.price_at_analysis, da.analysis_date
    FROM public.daily_analyses da
    WHERE da.user_id = past.user_id
      AND da.symbol  = past.symbol
      AND da.error IS NULL
      AND da.analysis_date BETWEEN past.analysis_date + (p_days - 2) AND past.analysis_date + (p_days + 2)
    ORDER BY ABS(da.analysis_date - (past.analysis_date + p_days))
    LIMIT 1
  ) later
  WHERE past.user_id = p_user_id
    AND past.error IS NULL
    AND past.price_at_analysis IS NOT NULL;
END;
$$;

-- ตัวอย่างใช้งาน:
-- SELECT * FROM get_track_record('USER_UUID', 7);
-- SELECT symbol, COUNT(*) FILTER (WHERE is_correct) * 100.0 / COUNT(*) AS win_rate_pct
--   FROM get_track_record('USER_UUID', 30) GROUP BY symbol;

NOTIFY pgrst, 'reload schema';
