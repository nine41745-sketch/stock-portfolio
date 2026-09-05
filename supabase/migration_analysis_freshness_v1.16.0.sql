-- ============================================================
-- v1.16.0 — AI analysis freshness clock
--
-- เก็บเวลาที่ input ซึ่งมีผลต่อคำแนะนำ AI เปลี่ยน เพื่อให้ UI ระบุได้ว่า
-- ผลล่าสุดเกิดก่อนข้อมูลพอร์ตปัจจุบันหรือไม่ โดยไม่แก้/ลบประวัติ analysis เดิม
--
-- - portfolio_updated_at: holdings INSERT/DELETE หรือ UPDATE symbol/shares/cost basis
-- - cash_updated_at: /api/user-settings เปลี่ยน cash_balance
-- - การแก้ notes อย่างเดียวไม่ทำให้ผล AI stale เพราะ notes ไม่ใช่ input ของ AI
--
-- Idempotent: รันซ้ำได้
-- ============================================================

BEGIN;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS portfolio_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cash_updated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.touch_user_portfolio_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.symbol IS NOT DISTINCT FROM OLD.symbol
     AND NEW.shares IS NOT DISTINCT FROM OLD.shares
     AND NEW.cost_basis_enc IS NOT DISTINCT FROM OLD.cost_basis_enc THEN
    RETURN NEW;
  END IF;

  v_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;

  INSERT INTO public.user_settings (user_id, portfolio_updated_at)
  VALUES (v_user_id, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET portfolio_updated_at = EXCLUDED.portfolio_updated_at;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS holdings_touch_portfolio_updated_at ON public.holdings;
CREATE TRIGGER holdings_touch_portfolio_updated_at
  AFTER INSERT OR UPDATE OR DELETE ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION public.touch_user_portfolio_updated_at();

-- ตั้ง baseline สำหรับพอร์ตที่มีอยู่แล้ว โดยไม่เขียนทับ freshness clock ถ้า migration เคยรันมาก่อน
INSERT INTO public.user_settings (user_id, portfolio_updated_at)
SELECT user_id, MAX(updated_at)
FROM public.holdings
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE
  SET portfolio_updated_at = COALESCE(
    public.user_settings.portfolio_updated_at,
    EXCLUDED.portfolio_updated_at
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
