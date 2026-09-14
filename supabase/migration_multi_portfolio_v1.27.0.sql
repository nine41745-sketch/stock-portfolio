-- v1.27.0 — Multi-Portfolio foundation
-- Adds portfolio ownership/scoping without copying or deleting existing business data.
-- Existing rows are backfilled into one default portfolio named "เจน" per auth user.
-- Run only after the v1.27.0 code is ready: new code supports both legacy (pre-migration)
-- and portfolio-aware schemas, while this migration updates uniqueness rules used by writes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.portfolios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT portfolios_name_length CHECK (char_length(BTRIM(name)) BETWEEN 1 AND 40 AND name !~ '[[:cntrl:]]')
);

CREATE UNIQUE INDEX IF NOT EXISTS portfolios_user_name_ci_key
  ON public.portfolios (user_id, lower(BTRIM(name)));
CREATE UNIQUE INDEX IF NOT EXISTS portfolios_one_default_per_user_idx
  ON public.portfolios (user_id)
  WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS portfolios_user_id_id_key
  ON public.portfolios (user_id, id);
CREATE INDEX IF NOT EXISTS portfolios_user_created_idx
  ON public.portfolios (user_id, created_at);

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portfolios_select_own ON public.portfolios;
CREATE POLICY portfolios_select_own
  ON public.portfolios FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS portfolios_insert_own ON public.portfolios;
CREATE POLICY portfolios_insert_own
  ON public.portfolios FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS portfolios_update_own ON public.portfolios;
CREATE POLICY portfolios_update_own
  ON public.portfolios FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Deliberately no authenticated DELETE grant in v1.27.0. Portfolio deletion is deferred
-- until a dedicated data-move / confirmation flow exists.
REVOKE ALL ON TABLE public.portfolios FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.portfolios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.portfolios TO service_role;

DROP TRIGGER IF EXISTS portfolios_updated_at ON public.portfolios;
CREATE TRIGGER portfolios_updated_at
  BEFORE UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- One default portfolio for every current auth user. Existing app data belongs to Jane,
-- so the first portfolio is named "เจน". Users can add "นาย" (or another name) from the UI.
INSERT INTO public.portfolios (user_id, name, is_default)
SELECT u.id, 'เจน', TRUE
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.portfolios p WHERE p.user_id = u.id
);

-- If a user somehow already had portfolios but none marked default, mark the earliest one.
WITH ranked AS (
  SELECT id, user_id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn
  FROM public.portfolios
  WHERE user_id NOT IN (SELECT user_id FROM public.portfolios WHERE is_default)
)
UPDATE public.portfolios p
SET is_default = TRUE
FROM ranked r
WHERE p.id = r.id AND r.rn = 1;

-- -----------------------------------------------------------------------------
-- Add + backfill portfolio_id on all portfolio-owned business tables.
-- Composite FKs guarantee portfolio_id belongs to the same user_id.
-- -----------------------------------------------------------------------------
ALTER TABLE public.holdings ADD COLUMN IF NOT EXISTS portfolio_id UUID;
ALTER TABLE public.portfolio_transactions ADD COLUMN IF NOT EXISTS portfolio_id UUID;
ALTER TABLE public.trade_plans ADD COLUMN IF NOT EXISTS portfolio_id UUID;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS portfolio_id UUID;
ALTER TABLE public.daily_analyses ADD COLUMN IF NOT EXISTS portfolio_id UUID;
ALTER TABLE public.manual_latest_analyses ADD COLUMN IF NOT EXISTS portfolio_id UUID;

-- Backfill is ownership metadata only. Disable generic updated_at triggers temporarily so
-- migration does not rewrite historical business timestamps. All changes are inside this
-- transaction, so a failure rolls trigger state back together with the schema changes.
ALTER TABLE public.holdings DISABLE TRIGGER holdings_updated_at;
ALTER TABLE public.portfolio_transactions DISABLE TRIGGER portfolio_transactions_updated_at;
ALTER TABLE public.trade_plans DISABLE TRIGGER trade_plans_updated_at;
ALTER TABLE public.user_settings DISABLE TRIGGER user_settings_updated_at;

UPDATE public.holdings h
SET portfolio_id = p.id
FROM public.portfolios p
WHERE h.portfolio_id IS NULL
  AND p.user_id = h.user_id
  AND p.is_default;

UPDATE public.portfolio_transactions t
SET portfolio_id = p.id
FROM public.portfolios p
WHERE t.portfolio_id IS NULL
  AND p.user_id = t.user_id
  AND p.is_default;

UPDATE public.trade_plans t
SET portfolio_id = p.id
FROM public.portfolios p
WHERE t.portfolio_id IS NULL
  AND p.user_id = t.user_id
  AND p.is_default;

UPDATE public.user_settings s
SET portfolio_id = p.id
FROM public.portfolios p
WHERE s.portfolio_id IS NULL
  AND p.user_id = s.user_id
  AND p.is_default;

UPDATE public.daily_analyses a
SET portfolio_id = p.id
FROM public.portfolios p
WHERE a.portfolio_id IS NULL
  AND p.user_id = a.user_id
  AND p.is_default;

UPDATE public.manual_latest_analyses a
SET portfolio_id = p.id
FROM public.portfolios p
WHERE a.portfolio_id IS NULL
  AND p.user_id = a.user_id
  AND p.is_default;

ALTER TABLE public.holdings ENABLE TRIGGER holdings_updated_at;
ALTER TABLE public.portfolio_transactions ENABLE TRIGGER portfolio_transactions_updated_at;
ALTER TABLE public.trade_plans ENABLE TRIGGER trade_plans_updated_at;
ALTER TABLE public.user_settings ENABLE TRIGGER user_settings_updated_at;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.holdings WHERE portfolio_id IS NULL) THEN
    RAISE EXCEPTION 'v1.27.0 backfill failed: holdings.portfolio_id still NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.portfolio_transactions WHERE portfolio_id IS NULL) THEN
    RAISE EXCEPTION 'v1.27.0 backfill failed: portfolio_transactions.portfolio_id still NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.trade_plans WHERE portfolio_id IS NULL) THEN
    RAISE EXCEPTION 'v1.27.0 backfill failed: trade_plans.portfolio_id still NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_settings WHERE portfolio_id IS NULL) THEN
    RAISE EXCEPTION 'v1.27.0 backfill failed: user_settings.portfolio_id still NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.daily_analyses WHERE portfolio_id IS NULL) THEN
    RAISE EXCEPTION 'v1.27.0 backfill failed: daily_analyses.portfolio_id still NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.manual_latest_analyses WHERE portfolio_id IS NULL) THEN
    RAISE EXCEPTION 'v1.27.0 backfill failed: manual_latest_analyses.portfolio_id still NULL';
  END IF;
END $$;

ALTER TABLE public.holdings ALTER COLUMN portfolio_id SET NOT NULL;
ALTER TABLE public.portfolio_transactions ALTER COLUMN portfolio_id SET NOT NULL;
ALTER TABLE public.trade_plans ALTER COLUMN portfolio_id SET NOT NULL;
ALTER TABLE public.user_settings ALTER COLUMN portfolio_id SET NOT NULL;
ALTER TABLE public.daily_analyses ALTER COLUMN portfolio_id SET NOT NULL;
ALTER TABLE public.manual_latest_analyses ALTER COLUMN portfolio_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holdings_user_portfolio_fkey') THEN
    ALTER TABLE public.holdings
      ADD CONSTRAINT holdings_user_portfolio_fkey
      FOREIGN KEY (user_id, portfolio_id)
      REFERENCES public.portfolios(user_id, id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_transactions_user_portfolio_fkey') THEN
    ALTER TABLE public.portfolio_transactions
      ADD CONSTRAINT portfolio_transactions_user_portfolio_fkey
      FOREIGN KEY (user_id, portfolio_id)
      REFERENCES public.portfolios(user_id, id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trade_plans_user_portfolio_fkey') THEN
    ALTER TABLE public.trade_plans
      ADD CONSTRAINT trade_plans_user_portfolio_fkey
      FOREIGN KEY (user_id, portfolio_id)
      REFERENCES public.portfolios(user_id, id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_user_portfolio_fkey') THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_user_portfolio_fkey
      FOREIGN KEY (user_id, portfolio_id)
      REFERENCES public.portfolios(user_id, id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_analyses_user_portfolio_fkey') THEN
    ALTER TABLE public.daily_analyses
      ADD CONSTRAINT daily_analyses_user_portfolio_fkey
      FOREIGN KEY (user_id, portfolio_id)
      REFERENCES public.portfolios(user_id, id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manual_latest_analyses_user_portfolio_fkey') THEN
    ALTER TABLE public.manual_latest_analyses
      ADD CONSTRAINT manual_latest_analyses_user_portfolio_fkey
      FOREIGN KEY (user_id, portfolio_id)
      REFERENCES public.portfolios(user_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- manual_latest_analyses v1.15.1 referenced holdings(user_id, symbol).
-- Drop that FK before changing Holdings uniqueness; a portfolio-aware FK is recreated below.
ALTER TABLE public.manual_latest_analyses
  DROP CONSTRAINT IF EXISTS manual_latest_analyses_holding_fk;

-- Holdings: same ticker may exist independently in Jane/Nay portfolios.
ALTER TABLE public.holdings DROP CONSTRAINT IF EXISTS holdings_user_id_symbol_key;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'holdings_user_portfolio_symbol_key') THEN
    ALTER TABLE public.holdings
      ADD CONSTRAINT holdings_user_portfolio_symbol_key
      UNIQUE (user_id, portfolio_id, symbol);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS holdings_user_portfolio_idx
  ON public.holdings (user_id, portfolio_id, symbol);

-- Transaction Ledger indexes scoped by portfolio.
CREATE INDEX IF NOT EXISTS portfolio_transactions_user_portfolio_date_idx
  ON public.portfolio_transactions (user_id, portfolio_id, trade_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS portfolio_transactions_user_portfolio_symbol_idx
  ON public.portfolio_transactions (user_id, portfolio_id, symbol, trade_date DESC)
  WHERE symbol IS NOT NULL;

-- Trade Plan: allow one active plan per ticker *per portfolio*.
DROP INDEX IF EXISTS public.trade_plans_one_active_symbol_idx;
CREATE UNIQUE INDEX trade_plans_one_active_symbol_idx
  ON public.trade_plans (user_id, portfolio_id, symbol)
  WHERE status IN ('WAITING', 'ENTERED');
CREATE INDEX IF NOT EXISTS trade_plans_user_portfolio_updated_idx
  ON public.trade_plans (user_id, portfolio_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS trade_plans_user_portfolio_symbol_idx
  ON public.trade_plans (user_id, portfolio_id, symbol, updated_at DESC);

-- Balances/settings become one row per user+portfolio instead of one row per user.
ALTER TABLE public.user_settings DROP CONSTRAINT IF EXISTS user_settings_pkey;
ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id, portfolio_id);

-- Ensure every portfolio with holdings has a freshness/settings row, while preserving an existing clock.
INSERT INTO public.user_settings (user_id, portfolio_id, portfolio_updated_at)
SELECT user_id, portfolio_id, MAX(updated_at)
FROM public.holdings
GROUP BY user_id, portfolio_id
ON CONFLICT (user_id, portfolio_id) DO UPDATE
  SET portfolio_updated_at = COALESCE(
    public.user_settings.portfolio_updated_at,
    EXCLUDED.portfolio_updated_at
  );

-- Daily AI history becomes portfolio-specific because recommendations use holdings/cash context.
ALTER TABLE public.daily_analyses
  DROP CONSTRAINT IF EXISTS daily_analyses_user_id_symbol_analysis_date_key;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_analyses_user_portfolio_symbol_date_key') THEN
    ALTER TABLE public.daily_analyses
      ADD CONSTRAINT daily_analyses_user_portfolio_symbol_date_key
      UNIQUE (user_id, portfolio_id, symbol, analysis_date);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_daily_analyses_portfolio_lookup
  ON public.daily_analyses (user_id, portfolio_id, symbol, analysis_date DESC);

-- Latest manual AI result is also portfolio-specific. This preserves the v1.15.1
-- delete-cascade behavior without letting a delete in Jane remove Nay's same ticker analysis.
ALTER TABLE public.manual_latest_analyses DROP CONSTRAINT IF EXISTS manual_latest_analyses_pkey;
ALTER TABLE public.manual_latest_analyses
  ADD CONSTRAINT manual_latest_analyses_pkey PRIMARY KEY (user_id, portfolio_id, symbol);
CREATE INDEX IF NOT EXISTS idx_manual_latest_analyses_portfolio_time
  ON public.manual_latest_analyses (user_id, portfolio_id, analysed_at DESC);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manual_latest_analyses_holding_fk') THEN
    ALTER TABLE public.manual_latest_analyses
      ADD CONSTRAINT manual_latest_analyses_holding_fk
      FOREIGN KEY (user_id, portfolio_id, symbol)
      REFERENCES public.holdings (user_id, portfolio_id, symbol)
      ON DELETE CASCADE;
  END IF;
END $$;

-- v1.16.0 freshness trigger must update the settings row of the affected portfolio.
CREATE OR REPLACE FUNCTION public.touch_user_portfolio_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
  v_portfolio_id UUID;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.symbol IS NOT DISTINCT FROM OLD.symbol
     AND NEW.shares IS NOT DISTINCT FROM OLD.shares
     AND NEW.cost_basis_enc IS NOT DISTINCT FROM OLD.cost_basis_enc THEN
    RETURN NEW;
  END IF;

  v_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_portfolio_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.portfolio_id ELSE NEW.portfolio_id END;

  INSERT INTO public.user_settings (user_id, portfolio_id, portfolio_updated_at)
  VALUES (v_user_id, v_portfolio_id, NOW())
  ON CONFLICT (user_id, portfolio_id) DO UPDATE
    SET portfolio_updated_at = EXCLUDED.portfolio_updated_at;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Holdings RPCs — new portfolio-aware overloads + legacy compatibility wrappers.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_holding(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_symbol TEXT,
  p_shares NUMERIC,
  p_cost_basis NUMERIC,
  p_enc_key TEXT,
  p_notes TEXT DEFAULT NULL,
  p_notes_provided BOOLEAN DEFAULT FALSE
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
  IF NOT EXISTS (
    SELECT 1 FROM public.portfolios p
    WHERE p.id = p_portfolio_id AND p.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'portfolio not found';
  END IF;

  IF p_cost_basis IS NOT NULL THEN
    v_enc := pgp_sym_encrypt(p_cost_basis::TEXT, p_enc_key);
  ELSE
    v_enc := NULL;
  END IF;

  INSERT INTO public.holdings (user_id, portfolio_id, symbol, shares, cost_basis_enc, notes)
  VALUES (
    p_user_id, p_portfolio_id, UPPER(p_symbol), p_shares, v_enc,
    CASE WHEN p_notes_provided THEN p_notes ELSE NULL END
  )
  ON CONFLICT (user_id, portfolio_id, symbol) DO UPDATE SET
    shares         = EXCLUDED.shares,
    cost_basis_enc = EXCLUDED.cost_basis_enc,
    notes          = CASE WHEN p_notes_provided THEN p_notes ELSE public.holdings.notes END,
    updated_at     = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_decrypted_holdings(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_enc_key TEXT
)
RETURNS TABLE (
  id UUID,
  symbol TEXT,
  shares NUMERIC,
  cost_basis NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    h.id,
    h.symbol,
    h.shares,
    CASE WHEN h.cost_basis_enc IS NULL THEN NULL
         ELSE pgp_sym_decrypt(h.cost_basis_enc::BYTEA, p_enc_key)::NUMERIC END,
    h.notes,
    h.created_at,
    h.updated_at
  FROM public.holdings h
  WHERE h.user_id = p_user_id
    AND h.portfolio_id = p_portfolio_id
  ORDER BY h.symbol;
END;
$$;

-- Legacy signatures continue to target the user's default portfolio.
CREATE OR REPLACE FUNCTION public.upsert_holding(
  p_user_id UUID,
  p_symbol TEXT,
  p_shares NUMERIC,
  p_cost_basis NUMERIC,
  p_enc_key TEXT,
  p_notes TEXT DEFAULT NULL,
  p_notes_provided BOOLEAN DEFAULT FALSE
)
RETURNS public.holdings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_portfolio_id UUID;
BEGIN
  SELECT id INTO v_portfolio_id
  FROM public.portfolios
  WHERE user_id = p_user_id AND is_default
  ORDER BY created_at, id
  LIMIT 1;
  IF v_portfolio_id IS NULL THEN RAISE EXCEPTION 'default portfolio not found'; END IF;
  RETURN public.upsert_holding(
    p_user_id, v_portfolio_id, p_symbol, p_shares, p_cost_basis,
    p_enc_key, p_notes, p_notes_provided
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_decrypted_holdings(
  p_user_id UUID,
  p_enc_key TEXT
)
RETURNS TABLE (
  id UUID,
  symbol TEXT,
  shares NUMERIC,
  cost_basis NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_portfolio_id UUID;
BEGIN
  SELECT id INTO v_portfolio_id
  FROM public.portfolios
  WHERE user_id = p_user_id AND is_default
  ORDER BY created_at, id
  LIMIT 1;
  IF v_portfolio_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT * FROM public.get_decrypted_holdings(p_user_id, v_portfolio_id, p_enc_key);
END;
$$;

-- -----------------------------------------------------------------------------
-- Transaction RPCs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_portfolio_transaction(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_id UUID,
  p_type TEXT,
  p_symbol TEXT,
  p_shares NUMERIC,
  p_price NUMERIC,
  p_fee NUMERIC,
  p_amount NUMERIC,
  p_trade_date DATE,
  p_note TEXT,
  p_enc_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_type TEXT := UPPER(TRIM(p_type));
  v_symbol TEXT := CASE WHEN p_symbol IS NULL THEN NULL ELSE UPPER(TRIM(p_symbol)) END;
  v_price_enc TEXT;
  v_fee_enc TEXT;
  v_amount_enc TEXT;
  v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.portfolios p
    WHERE p.id = p_portfolio_id AND p.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'portfolio not found';
  END IF;
  IF p_trade_date IS NULL OR p_enc_key IS NULL OR p_enc_key = '' THEN
    RAISE EXCEPTION 'required transaction input missing';
  END IF;
  IF v_type NOT IN ('BUY', 'SELL', 'OPENING_POSITION', 'DIVIDEND', 'DEPOSIT', 'WITHDRAW') THEN
    RAISE EXCEPTION 'invalid transaction type';
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 1000 THEN
    RAISE EXCEPTION 'note too long';
  END IF;

  IF v_type IN ('BUY', 'SELL', 'OPENING_POSITION') THEN
    IF v_symbol IS NULL OR v_symbol !~ '^[A-Z0-9][A-Z0-9.-]{0,14}$' THEN RAISE EXCEPTION 'invalid symbol'; END IF;
    IF p_shares IS NULL OR p_shares <= 0 OR p_price IS NULL OR p_price <= 0 THEN RAISE EXCEPTION 'shares and price must be positive'; END IF;
    IF p_fee IS NOT NULL AND p_fee < 0 THEN RAISE EXCEPTION 'fee must not be negative'; END IF;
    IF p_amount IS NOT NULL THEN RAISE EXCEPTION 'amount is not allowed for share transactions'; END IF;
  ELSIF v_type = 'DIVIDEND' THEN
    IF v_symbol IS NULL OR v_symbol !~ '^[A-Z0-9][A-Z0-9.-]{0,14}$' THEN RAISE EXCEPTION 'invalid symbol'; END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'dividend amount must be positive'; END IF;
    IF p_shares IS NOT NULL OR p_price IS NOT NULL OR p_fee IS NOT NULL THEN RAISE EXCEPTION 'share fields are not allowed for dividend'; END IF;
  ELSE
    IF v_symbol IS NOT NULL OR p_shares IS NOT NULL OR p_price IS NOT NULL OR p_fee IS NOT NULL THEN RAISE EXCEPTION 'symbol/share fields are not allowed for cash transactions'; END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'cash amount must be positive'; END IF;
  END IF;

  v_price_enc := CASE WHEN p_price IS NULL THEN NULL ELSE pgp_sym_encrypt(p_price::TEXT, p_enc_key)::TEXT END;
  v_fee_enc := CASE WHEN p_fee IS NULL THEN NULL ELSE pgp_sym_encrypt(p_fee::TEXT, p_enc_key)::TEXT END;
  v_amount_enc := CASE WHEN p_amount IS NULL THEN NULL ELSE pgp_sym_encrypt(p_amount::TEXT, p_enc_key)::TEXT END;

  IF p_id IS NULL THEN
    INSERT INTO public.portfolio_transactions (
      user_id, portfolio_id, transaction_type, symbol, shares,
      price_enc, fee_enc, amount_enc, trade_date, note
    ) VALUES (
      p_user_id, p_portfolio_id, v_type, v_symbol, p_shares,
      v_price_enc, v_fee_enc, v_amount_enc, p_trade_date, p_note
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.portfolio_transactions
    SET transaction_type = v_type,
        symbol = v_symbol,
        shares = p_shares,
        price_enc = v_price_enc,
        fee_enc = v_fee_enc,
        amount_enc = v_amount_enc,
        trade_date = p_trade_date,
        note = p_note,
        updated_at = NOW()
    WHERE id = p_id AND user_id = p_user_id AND portfolio_id = p_portfolio_id
    RETURNING id INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'transaction not found'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_decrypted_portfolio_transactions(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_enc_key TEXT
)
RETURNS TABLE (
  id UUID,
  transaction_type TEXT,
  symbol TEXT,
  shares NUMERIC,
  price NUMERIC,
  fee NUMERIC,
  amount NUMERIC,
  trade_date DATE,
  note TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.transaction_type, t.symbol, t.shares,
    CASE WHEN t.price_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.price_enc::BYTEA, p_enc_key)::NUMERIC END,
    CASE WHEN t.fee_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.fee_enc::BYTEA, p_enc_key)::NUMERIC END,
    CASE WHEN t.amount_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.amount_enc::BYTEA, p_enc_key)::NUMERIC END,
    t.trade_date, t.note, t.created_at, t.updated_at
  FROM public.portfolio_transactions t
  WHERE t.user_id = p_user_id AND t.portfolio_id = p_portfolio_id
  ORDER BY t.trade_date DESC, t.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_portfolio_transaction(
  p_user_id UUID,
  p_id UUID,
  p_type TEXT,
  p_symbol TEXT,
  p_shares NUMERIC,
  p_price NUMERIC,
  p_fee NUMERIC,
  p_amount NUMERIC,
  p_trade_date DATE,
  p_note TEXT,
  p_enc_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_portfolio_id UUID;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE user_id = p_user_id AND is_default ORDER BY created_at, id LIMIT 1;
  IF v_portfolio_id IS NULL THEN RAISE EXCEPTION 'default portfolio not found'; END IF;
  RETURN public.save_portfolio_transaction(
    p_user_id, v_portfolio_id, p_id, p_type, p_symbol, p_shares, p_price,
    p_fee, p_amount, p_trade_date, p_note, p_enc_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_decrypted_portfolio_transactions(
  p_user_id UUID,
  p_enc_key TEXT
)
RETURNS TABLE (
  id UUID,
  transaction_type TEXT,
  symbol TEXT,
  shares NUMERIC,
  price NUMERIC,
  fee NUMERIC,
  amount NUMERIC,
  trade_date DATE,
  note TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_portfolio_id UUID;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE user_id = p_user_id AND is_default ORDER BY created_at, id LIMIT 1;
  IF v_portfolio_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT * FROM public.get_decrypted_portfolio_transactions(p_user_id, v_portfolio_id, p_enc_key);
END;
$$;

-- -----------------------------------------------------------------------------
-- Trade Plan RPCs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_trade_plan(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_id UUID,
  p_symbol TEXT,
  p_status TEXT,
  p_source TEXT,
  p_entry_low NUMERIC,
  p_entry_high NUMERIC,
  p_add_zone_low NUMERIC,
  p_add_zone_high NUMERIC,
  p_stop_loss NUMERIC,
  p_target1 NUMERIC,
  p_target2 NUMERIC,
  p_budget NUMERIC,
  p_planned_shares NUMERIC,
  p_note TEXT,
  p_enc_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_symbol TEXT := UPPER(TRIM(p_symbol));
  v_status TEXT := UPPER(TRIM(COALESCE(p_status, 'WAITING'));
  v_source TEXT := UPPER(TRIM(COALESCE(p_source, 'MANUAL'));
  v_entry_mid NUMERIC;
  v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.portfolios p
    WHERE p.id = p_portfolio_id AND p.user_id = p_user_id
  ) THEN RAISE EXCEPTION 'portfolio not found'; END IF;
  IF p_enc_key IS NULL OR p_enc_key = '' THEN RAISE EXCEPTION 'required trade plan input missing'; END IF;
  IF v_symbol IS NULL OR v_symbol !~ '^[A-Z0-9][A-Z0-9.-]{0,14}$' THEN RAISE EXCEPTION 'invalid symbol'; END IF;
  IF v_status NOT IN ('WAITING', 'ENTERED', 'CANCELLED', 'CLOSED') THEN RAISE EXCEPTION 'invalid trade plan status'; END IF;
  IF v_source NOT IN ('MANUAL', 'STOCK_CHECK') THEN RAISE EXCEPTION 'invalid trade plan source'; END IF;
  IF p_entry_low IS NULL OR p_entry_low <= 0 OR p_entry_high IS NULL OR p_entry_high <= 0 OR p_entry_high < p_entry_low THEN RAISE EXCEPTION 'invalid planned entry zone'; END IF;
  IF (p_add_zone_low IS NULL) <> (p_add_zone_high IS NULL) THEN RAISE EXCEPTION 'add zone must include both bounds'; END IF;
  IF p_add_zone_low IS NOT NULL AND (p_add_zone_low <= 0 OR p_add_zone_high < p_add_zone_low) THEN RAISE EXCEPTION 'invalid add zone'; END IF;
  IF p_budget IS NOT NULL AND p_budget <= 0 THEN RAISE EXCEPTION 'budget must be positive'; END IF;
  IF p_planned_shares IS NOT NULL AND p_planned_shares <= 0 THEN RAISE EXCEPTION 'planned shares must be positive'; END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 1000 THEN RAISE EXCEPTION 'note too long'; END IF;

  v_entry_mid := (p_entry_low + p_entry_high) / 2;
  IF p_stop_loss IS NOT NULL AND (p_stop_loss <= 0 OR p_stop_loss >= v_entry_mid) THEN RAISE EXCEPTION 'stop loss must be below planned entry midpoint'; END IF;
  IF p_target1 IS NOT NULL AND p_target1 <= v_entry_mid THEN RAISE EXCEPTION 'target1 must be above planned entry midpoint'; END IF;
  IF p_target2 IS NOT NULL AND p_target2 <= v_entry_mid THEN RAISE EXCEPTION 'target2 must be above planned entry midpoint'; END IF;
  IF p_target1 IS NOT NULL AND p_target2 IS NOT NULL AND p_target2 <= p_target1 THEN RAISE EXCEPTION 'target2 must be above target1'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.trade_plans (
      user_id, portfolio_id, symbol, status, source,
      entry_low_enc, entry_high_enc, add_zone_low_enc, add_zone_high_enc,
      stop_loss_enc, target1_enc, target2_enc, budget_enc, planned_shares_enc, note_enc
    ) VALUES (
      p_user_id, p_portfolio_id, v_symbol, v_status, v_source,
      pgp_sym_encrypt(p_entry_low::TEXT, p_enc_key)::TEXT,
      pgp_sym_encrypt(p_entry_high::TEXT, p_enc_key)::TEXT,
      CASE WHEN p_add_zone_low IS NULL THEN NULL ELSE pgp_sym_encrypt(p_add_zone_low::TEXT, p_enc_key)::TEXT END,
      CASE WHEN p_add_zone_high IS NULL THEN NULL ELSE pgp_sym_encrypt(p_add_zone_high::TEXT, p_enc_key)::TEXT END,
      CASE WHEN p_stop_loss IS NULL THEN NULL ELSE pgp_sym_encrypt(p_stop_loss::TEXT, p_enc_key)::TEXT END,
      CASE WHEN p_target1 IS NULL THEN NULL ELSE pgp_sym_encrypt(p_target1::TEXT, p_enc_key)::TEXT END,
      CASE WHEN p_target2 IS NULL THEN NULL ELSE pgp_sym_encrypt(p_target2::TEXT, p_enc_key)::TEXT END,
      CASE WHEN p_budget IS NULL THEN NULL ELSE pgp_sym_encrypt(p_budget::TEXT, p_enc_key)::TEXT END,
      CASE WHEN p_planned_shares IS NULL THEN NULL ELSE pgp_sym_encrypt(p_planned_shares::TEXT, p_enc_key)::TEXT END,
      CASE WHEN p_note IS NULL THEN NULL ELSE pgp_sym_encrypt(p_note, p_enc_key)::TEXT END
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.trade_plans
    SET symbol = v_symbol,
        status = v_status,
        source = v_source,
        entry_low_enc = pgp_sym_encrypt(p_entry_low::TEXT, p_enc_key)::TEXT,
        entry_high_enc = pgp_sym_encrypt(p_entry_high::TEXT, p_enc_key)::TEXT,
        add_zone_low_enc = CASE WHEN p_add_zone_low IS NULL THEN NULL ELSE pgp_sym_encrypt(p_add_zone_low::TEXT, p_enc_key)::TEXT END,
        add_zone_high_enc = CASE WHEN p_add_zone_high IS NULL THEN NULL ELSE pgp_sym_encrypt(p_add_zone_high::TEXT, p_enc_key)::TEXT END,
        stop_loss_enc = CASE WHEN p_stop_loss IS NULL THEN NULL ELSE pgp_sym_encrypt(p_stop_loss::TEXT, p_enc_key)::TEXT END,
        target1_enc = CASE WHEN p_target1 IS NULL THEN NULL ELSE pgp_sym_encrypt(p_target1::TEXT, p_enc_key)::TEXT END,
        target2_enc = CASE WHEN p_target2 IS NULL THEN NULL ELSE pgp_sym_encrypt(p_target2::TEXT, p_enc_key)::TEXT END,
        budget_enc = CASE WHEN p_budget IS NULL THEN NULL ELSE pgp_sym_encrypt(p_budget::TEXT, p_enc_key)::TEXT END,
        planned_shares_enc = CASE WHEN p_planned_shares IS NULL THEN NULL ELSE pgp_sym_encrypt(p_planned_shares::TEXT, p_enc_key)::TEXT END,
        note_enc = CASE WHEN p_note IS NULL THEN NULL ELSE pgp_sym_encrypt(p_note, p_enc_key)::TEXT END,
        updated_at = NOW()
    WHERE id = p_id AND user_id = p_user_id AND portfolio_id = p_portfolio_id
    RETURNING id INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'trade plan not found'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_decrypted_trade_plans(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_enc_key TEXT
)
RETURNS TABLE (
  id UUID,
  symbol TEXT,
  status TEXT,
  source TEXT,
  entry_low NUMERIC,
  entry_high NUMERIC,
  add_zone_low NUMERIC,
  add_zone_high NUMERIC,
  stop_loss NUMERIC,
  target1 NUMERIC,
  target2 NUMERIC,
  budget NUMERIC,
  planned_shares NUMERIC,
  note TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.symbol, t.status, t.source,
    pgp_sym_decrypt(t.entry_low_enc::BYTEA, p_enc_key)::NUMERIC,
    pgp_sym_decrypt(t.entry_high_enc::BYTEA, p_enc_key)::NUMERIC,
    CASE WHEN t.add_zone_low_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.add_zone_low_enc::BYTEA, p_enc_key)::NUMERIC END,
    CASE WHEN t.add_zone_high_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.add_zone_high_enc::BYTEA, p_enc_key)::NUMERIC END,
    CASE WHEN t.stop_loss_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.stop_loss_enc::BYTEA, p_enc_key)::NUMERIC END,
    CASE WHEN t.target1_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.target1_enc::BYTEA, p_enc_key)::NUMERIC END,
    CASE WHEN t.target2_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.target2_enc::BYTEA, p_enc_key)::NUMERIC END,
    CASE WHEN t.budget_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.budget_enc::BYTEA, p_enc_key)::NUMERIC END,
    CASE WHEN t.planned_shares_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.planned_shares_enc::BYTEA, p_enc_key)::NUMERIC END,
    CASE WHEN t.note_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.note_enc::BYTEA, p_enc_key) END,
    t.created_at, t.updated_at
  FROM public.trade_plans t
  WHERE t.user_id = p_user_id AND t.portfolio_id = p_portfolio_id
  ORDER BY
    CASE t.status WHEN 'WAITING' THEN 0 WHEN 'ENTERED' THEN 1 WHEN 'CANCELLED' THEN 2 ELSE 3 END,
    t.updated_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_trade_plan(
  p_user_id UUID,
  p_id UUID,
  p_symbol TEXT,
  p_status TEXT,
  p_source TEXT,
  p_entry_low NUMERIC,
  p_entry_high NUMERIC,
  p_add_zone_low NUMERIC,
  p_add_zone_high NUMERIC,
  p_stop_loss NUMERIC,
  p_target1 NUMERIC,
  p_target2 NUMERIC,
  p_budget NUMERIC,
  p_planned_shares NUMERIC,
  p_note TEXT,
  p_enc_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_portfolio_id UUID;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE user_id = p_user_id AND is_default ORDER BY created_at, id LIMIT 1;
  IF v_portfolio_id IS NULL THEN RAISE EXCEPTION 'default portfolio not found'; END IF;
  RETURN public.save_trade_plan(
    p_user_id, v_portfolio_id, p_id, p_symbol, p_status, p_source,
    p_entry_low, p_entry_high, p_add_zone_low, p_add_zone_high,
    p_stop_loss, p_target1, p_target2, p_budget, p_planned_shares,
    p_note, p_enc_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_decrypted_trade_plans(
  p_user_id UUID,
  p_enc_key TEXT
)
RETURNS TABLE (
  id UUID,
  symbol TEXT,
  status TEXT,
  source TEXT,
  entry_low NUMERIC,
  entry_high NUMERIC,
  add_zone_low NUMERIC,
  add_zone_high NUMERIC,
  stop_loss NUMERIC,
  target1 NUMERIC,
  target2 NUMERIC,
  budget NUMERIC,
  planned_shares NUMERIC,
  note TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_portfolio_id UUID;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE user_id = p_user_id AND is_default ORDER BY created_at, id LIMIT 1;
  IF v_portfolio_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT * FROM public.get_decrypted_trade_plans(p_user_id, v_portfolio_id, p_enc_key);
END;
$$;

-- -----------------------------------------------------------------------------
-- Portfolio-aware latest manual analysis persistence.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_latest_manual_analysis(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_symbol TEXT,
  p_result JSONB,
  p_analysed_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_user_id IS NULL OR p_portfolio_id IS NULL OR p_result IS NULL OR p_analysed_at IS NULL
     OR BTRIM(COALESCE(p_symbol, '')) = '' THEN
    RAISE EXCEPTION 'invalid latest analysis payload';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.portfolios p
    WHERE p.id = p_portfolio_id AND p.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'portfolio not found';
  END IF;

  INSERT INTO public.manual_latest_analyses (
    user_id, portfolio_id, symbol, result, analysed_at
  ) VALUES (
    p_user_id, p_portfolio_id, UPPER(BTRIM(p_symbol)), p_result, p_analysed_at
  )
  ON CONFLICT (user_id, portfolio_id, symbol) DO UPDATE SET
    result      = EXCLUDED.result,
    analysed_at = EXCLUDED.analysed_at,
    updated_at  = NOW()
  WHERE public.manual_latest_analyses.analysed_at <= EXCLUDED.analysed_at;
END;
$$;

-- Legacy signature remains mapped to the default portfolio for code-first rollout / rollback safety.
CREATE OR REPLACE FUNCTION public.save_latest_manual_analysis(
  p_user_id UUID,
  p_symbol TEXT,
  p_result JSONB,
  p_analysed_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_portfolio_id UUID;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE user_id = p_user_id AND is_default ORDER BY created_at, id LIMIT 1;
  IF v_portfolio_id IS NULL THEN RAISE EXCEPTION 'default portfolio not found'; END IF;
  PERFORM public.save_latest_manual_analysis(
    p_user_id, v_portfolio_id, p_symbol, p_result, p_analysed_at
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Track Record is evaluated inside one portfolio because daily recommendations use that
-- portfolio's holdings/cash context. The legacy signature targets the default portfolio.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_track_record(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_days INT
)
RETURNS TABLE (
  symbol TEXT,
  analysis_date DATE,
  action TEXT,
  price_at_analysis NUMERIC,
  price_now NUMERIC,
  evaluated_date DATE,
  pct_change NUMERIC,
  is_correct BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    past.symbol,
    past.analysis_date,
    past.action,
    past.price_at_analysis,
    later.price_at_analysis AS price_now,
    later.analysis_date AS evaluated_date,
    ROUND(((later.price_at_analysis - past.price_at_analysis) / NULLIF(past.price_at_analysis, 0)) * 100, 2) AS pct_change,
    CASE
      WHEN past.action = 'BUY' AND later.price_at_analysis > past.price_at_analysis THEN TRUE
      WHEN past.action IN ('SELL_ALL', 'SELL_PARTIAL') AND later.price_at_analysis < past.price_at_analysis THEN TRUE
      WHEN past.action = 'HOLD'
        AND ABS((later.price_at_analysis - past.price_at_analysis) / NULLIF(past.price_at_analysis, 0)) <= 0.05 THEN TRUE
      ELSE FALSE
    END AS is_correct
  FROM public.daily_analyses past
  CROSS JOIN LATERAL (
    SELECT da.price_at_analysis, da.analysis_date
    FROM public.daily_analyses da
    WHERE da.user_id = past.user_id
      AND da.portfolio_id = past.portfolio_id
      AND da.symbol = past.symbol
      AND da.error IS NULL
      AND da.analysis_date BETWEEN past.analysis_date + (p_days - 2) AND past.analysis_date + (p_days + 2)
    ORDER BY ABS(da.analysis_date - (past.analysis_date + p_days))
    LIMIT 1
  ) later
  WHERE past.user_id = p_user_id
    AND past.portfolio_id = p_portfolio_id
    AND past.error IS NULL
    AND past.price_at_analysis IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_track_record(p_user_id UUID, p_days INT)
RETURNS TABLE (
  symbol TEXT,
  analysis_date DATE,
  action TEXT,
  price_at_analysis NUMERIC,
  price_now NUMERIC,
  evaluated_date DATE,
  pct_change NUMERIC,
  is_correct BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_portfolio_id UUID;
BEGIN
  SELECT id INTO v_portfolio_id FROM public.portfolios
  WHERE user_id = p_user_id AND is_default ORDER BY created_at, id LIMIT 1;
  IF v_portfolio_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.get_track_record(p_user_id, v_portfolio_id, p_days);
END;
$$;

-- RPC permissions: key-bearing functions remain server/service-role only.
REVOKE ALL ON FUNCTION public.upsert_holding(UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_decrypted_holdings(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_portfolio_transaction(UUID, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_decrypted_portfolio_transactions(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_trade_plan(UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_decrypted_trade_plans(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_holding(UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_decrypted_holdings(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_portfolio_transaction(UUID, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_decrypted_portfolio_transactions(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_trade_plan(UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_decrypted_trade_plans(UUID, UUID, TEXT) TO service_role;

-- Keep legacy service-role grants explicit after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.upsert_holding(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_decrypted_holdings(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_portfolio_transaction(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_decrypted_portfolio_transactions(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_trade_plan(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_decrypted_trade_plans(UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_holding(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_decrypted_holdings(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_portfolio_transaction(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_decrypted_portfolio_transactions(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_trade_plan(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_decrypted_trade_plans(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.save_latest_manual_analysis(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_latest_manual_analysis(UUID, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_latest_manual_analysis(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_latest_manual_analysis(UUID, TEXT, JSONB, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.get_track_record(UUID, UUID, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_track_record(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_track_record(UUID, UUID, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_track_record(UUID, INT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
