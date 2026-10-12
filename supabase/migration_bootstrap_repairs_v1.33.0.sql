-- v1.33.0 — safe forward repair for databases that already applied the
-- historical multi-portfolio migration before its source fixes were added.
-- This migration changes function definitions and function settings only.
-- It does not read, rewrite, or delete application rows.

BEGIN;

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
  SELECT p.id INTO v_portfolio_id
  FROM public.portfolios AS p
  WHERE p.user_id = p_user_id AND p.is_default
  ORDER BY p.created_at, p.id
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
  SELECT p.id INTO v_portfolio_id
  FROM public.portfolios AS p
  WHERE p.user_id = p_user_id AND p.is_default
  ORDER BY p.created_at, p.id
  LIMIT 1;
  IF v_portfolio_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT *
  FROM public.get_decrypted_holdings(p_user_id, v_portfolio_id, p_enc_key);
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
  SELECT p.id INTO v_portfolio_id
  FROM public.portfolios AS p
  WHERE p.user_id = p_user_id AND p.is_default
  ORDER BY p.created_at, p.id
  LIMIT 1;
  IF v_portfolio_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT *
  FROM public.get_decrypted_portfolio_transactions(p_user_id, v_portfolio_id, p_enc_key);
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
  SELECT p.id INTO v_portfolio_id
  FROM public.portfolios AS p
  WHERE p.user_id = p_user_id AND p.is_default
  ORDER BY p.created_at, p.id
  LIMIT 1;
  IF v_portfolio_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT *
  FROM public.get_decrypted_trade_plans(p_user_id, v_portfolio_id, p_enc_key);
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
SET search_path = pg_catalog
AS $$
DECLARE
  v_portfolio_id UUID;
BEGIN
  SELECT p.id INTO v_portfolio_id
  FROM public.portfolios AS p
  WHERE p.user_id = p_user_id AND p.is_default
  ORDER BY p.created_at, p.id
  LIMIT 1;
  IF v_portfolio_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.get_track_record(p_user_id, v_portfolio_id, p_days);
END;
$$;

ALTER FUNCTION public.update_updated_at() SET search_path = pg_catalog;
ALTER FUNCTION public.get_track_record(UUID, UUID, INT) SET search_path = pg_catalog;

-- CREATE OR REPLACE preserves existing ACLs, and these explicit grants keep
-- the intended service-role-only boundary clear on both fresh and old DBs.
REVOKE ALL ON FUNCTION public.upsert_holding(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_holding(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public.get_decrypted_holdings(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_decrypted_holdings(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.get_decrypted_portfolio_transactions(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_decrypted_portfolio_transactions(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.get_decrypted_trade_plans(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_decrypted_trade_plans(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.get_track_record(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_track_record(UUID, INT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
