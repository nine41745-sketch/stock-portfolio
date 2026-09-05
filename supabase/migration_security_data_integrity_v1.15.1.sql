-- ============================================================
-- v1.15.1 — Data integrity hardening
--
-- 1) กันค่าติดลบ/NaN ในจำนวนหุ้นและยอดเงินที่ฐานข้อมูลอีกชั้น
-- 2) ลบ manual AI result ที่เป็น orphan จากอดีต
-- 3) ผูก manual_latest_analyses กับ holdings แบบ ON DELETE CASCADE
--    เพื่อให้ลบหุ้นแล้วผลวิเคราะห์ manual เก่าหายไปใน transaction เดียวกัน
--
-- Idempotent: รันซ้ำได้
-- ============================================================

BEGIN;

-- ก่อนเพิ่ม FK ให้เก็บกวาดผล manual เก่าที่ ticker ถูกลบไปแล้ว (ถ้ามี)
DELETE FROM public.manual_latest_analyses AS m
WHERE NOT EXISTS (
  SELECT 1
  FROM public.holdings AS h
  WHERE h.user_id = m.user_id
    AND h.symbol = m.symbol
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'holdings_shares_nonnegative'
      AND conrelid = 'public.holdings'::regclass
  ) THEN
    ALTER TABLE public.holdings
      ADD CONSTRAINT holdings_shares_nonnegative
      CHECK (shares <> 'NaN'::numeric AND shares >= 0)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.holdings
  VALIDATE CONSTRAINT holdings_shares_nonnegative;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_settings_cash_nonnegative'
      AND conrelid = 'public.user_settings'::regclass
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_cash_nonnegative
      CHECK (cash_balance <> 'NaN'::numeric AND cash_balance >= 0)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_settings_dime_nonnegative'
      AND conrelid = 'public.user_settings'::regclass
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_dime_nonnegative
      CHECK (dime_balance <> 'NaN'::numeric AND dime_balance >= 0)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_settings_capital_nonnegative'
      AND conrelid = 'public.user_settings'::regclass
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_capital_nonnegative
      CHECK (initial_capital <> 'NaN'::numeric AND initial_capital >= 0)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.user_settings VALIDATE CONSTRAINT user_settings_cash_nonnegative;
ALTER TABLE public.user_settings VALIDATE CONSTRAINT user_settings_dime_nonnegative;
ALTER TABLE public.user_settings VALIDATE CONSTRAINT user_settings_capital_nonnegative;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'manual_latest_analyses_holding_fk'
      AND conrelid = 'public.manual_latest_analyses'::regclass
  ) THEN
    ALTER TABLE public.manual_latest_analyses
      ADD CONSTRAINT manual_latest_analyses_holding_fk
      FOREIGN KEY (user_id, symbol)
      REFERENCES public.holdings (user_id, symbol)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.manual_latest_analyses
  VALIDATE CONSTRAINT manual_latest_analyses_holding_fk;

COMMIT;

NOTIFY pgrst, 'reload schema';
