-- v1.27.1 — Atomic BUY/SELL Auto Sync
-- New real-trade path: one RPC writes the ledger and updates Holdings + Dime in one DB transaction.
-- Existing ledger rows remain manual-only (sync_portfolio = false) and are not re-applied.

BEGIN;

ALTER TABLE public.portfolio_transactions
  ADD COLUMN IF NOT EXISTS sync_portfolio BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.portfolio_transactions.sync_portfolio IS
  'TRUE only for immutable BUY/SELL rows that were atomically applied to Holdings and Dime.';

CREATE OR REPLACE FUNCTION public.prevent_synced_transaction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.sync_portfolio THEN
    RAISE EXCEPTION 'synced transaction is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS portfolio_transactions_protect_synced ON public.portfolio_transactions;
CREATE TRIGGER portfolio_transactions_protect_synced
  BEFORE UPDATE OR DELETE ON public.portfolio_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_synced_transaction_mutation();

CREATE OR REPLACE FUNCTION public.record_synced_trade(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_type TEXT,
  p_symbol TEXT,
  p_shares NUMERIC,
  p_price NUMERIC,
  p_fee NUMERIC,
  p_trade_date DATE,
  p_note TEXT,
  p_enc_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_type TEXT := UPPER(BTRIM(p_type));
  v_symbol TEXT := UPPER(BTRIM(p_symbol));
  v_fee NUMERIC := COALESCE(p_fee, 0);
  v_holding_id UUID;
  v_holding_found BOOLEAN := FALSE;
  v_current_shares NUMERIC := 0;
  v_current_cost NUMERIC;
  v_current_dime NUMERIC := 0;
  v_new_shares NUMERIC := 0;
  v_new_cost NUMERIC;
  v_cash_delta NUMERIC := 0;
  v_new_dime NUMERIC := 0;
  v_transaction_id UUID;
  v_holding_deleted BOOLEAN := FALSE;
BEGIN
  IF p_user_id IS NULL OR p_portfolio_id IS NULL OR p_trade_date IS NULL OR p_enc_key IS NULL OR p_enc_key = '' THEN
    RAISE EXCEPTION 'required trade input missing';
  END IF;
  IF v_type NOT IN ('BUY', 'SELL') THEN
    RAISE EXCEPTION 'invalid trade type';
  END IF;
  IF v_symbol IS NULL OR v_symbol !~ '^[A-Z0-9][A-Z0-9.-]{0,14}$' THEN
    RAISE EXCEPTION 'invalid symbol';
  END IF;
  IF p_shares IS NULL OR p_shares <= 0 OR p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'invalid shares or price';
  END IF;
  IF v_fee < 0 THEN
    RAISE EXCEPTION 'invalid fee';
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 1000 THEN
    RAISE EXCEPTION 'invalid note';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolios p
    WHERE p.id = p_portfolio_id AND p.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'portfolio not found';
  END IF;

  -- Serialize cash-changing trades for one portfolio and guarantee a settings row exists.
  INSERT INTO public.user_settings (user_id, portfolio_id, dime_balance)
  VALUES (p_user_id, p_portfolio_id, 0)
  ON CONFLICT (user_id, portfolio_id) DO NOTHING;

  SELECT COALESCE(s.dime_balance, 0)
  INTO v_current_dime
  FROM public.user_settings s
  WHERE s.user_id = p_user_id AND s.portfolio_id = p_portfolio_id
  FOR UPDATE;

  SELECT
    h.id,
    h.shares,
    CASE
      WHEN h.cost_basis_enc IS NULL THEN NULL
      ELSE pgp_sym_decrypt(h.cost_basis_enc::BYTEA, p_enc_key)::NUMERIC
    END
  INTO v_holding_id, v_current_shares, v_current_cost
  FROM public.holdings h
  WHERE h.user_id = p_user_id
    AND h.portfolio_id = p_portfolio_id
    AND h.symbol = v_symbol
  FOR UPDATE;
  v_holding_found := FOUND;

  IF v_type = 'BUY' THEN
    v_cash_delta := -((p_shares * p_price) + v_fee);
    v_new_dime := v_current_dime + v_cash_delta;
    IF v_new_dime < 0 THEN
      RAISE EXCEPTION 'insufficient Dime balance';
    END IF;

    IF v_holding_found THEN
      IF v_current_shares > 0 AND v_current_cost IS NULL THEN
        RAISE EXCEPTION 'existing cost basis missing';
      END IF;
      v_new_shares := v_current_shares + p_shares;
      v_new_cost := ((v_current_shares * COALESCE(v_current_cost, 0)) + (p_shares * p_price) + v_fee) / v_new_shares;
    ELSE
      v_new_shares := p_shares;
      v_new_cost := ((p_shares * p_price) + v_fee) / p_shares;
    END IF;

    PERFORM public.upsert_holding(
      p_user_id,
      p_portfolio_id,
      v_symbol,
      v_new_shares,
      v_new_cost,
      p_enc_key,
      NULL,
      FALSE
    );
  ELSE
    IF NOT v_holding_found THEN
      RAISE EXCEPTION 'holding not found';
    END IF;
    IF p_shares > v_current_shares THEN
      RAISE EXCEPTION 'sell shares exceed holding';
    END IF;

    v_cash_delta := (p_shares * p_price) - v_fee;
    IF v_cash_delta < 0 THEN
      RAISE EXCEPTION 'sell fee exceeds proceeds';
    END IF;
    v_new_dime := v_current_dime + v_cash_delta;
    v_new_shares := v_current_shares - p_shares;
    v_new_cost := v_current_cost;

    IF ABS(v_new_shares) < 0.000001 THEN
      DELETE FROM public.holdings
      WHERE id = v_holding_id
        AND user_id = p_user_id
        AND portfolio_id = p_portfolio_id;
      v_new_shares := 0;
      v_holding_deleted := TRUE;
    ELSE
      UPDATE public.holdings
      SET shares = v_new_shares,
          updated_at = NOW()
      WHERE id = v_holding_id
        AND user_id = p_user_id
        AND portfolio_id = p_portfolio_id;
    END IF;
  END IF;

  UPDATE public.user_settings
  SET dime_balance = v_new_dime,
      dime_updated_at = NOW()
  WHERE user_id = p_user_id
    AND portfolio_id = p_portfolio_id;

  INSERT INTO public.portfolio_transactions (
    user_id,
    portfolio_id,
    transaction_type,
    symbol,
    shares,
    price_enc,
    fee_enc,
    amount_enc,
    trade_date,
    note,
    sync_portfolio
  ) VALUES (
    p_user_id,
    p_portfolio_id,
    v_type,
    v_symbol,
    p_shares,
    pgp_sym_encrypt(p_price::TEXT, p_enc_key)::TEXT,
    CASE WHEN p_fee IS NULL THEN NULL ELSE pgp_sym_encrypt(p_fee::TEXT, p_enc_key)::TEXT END,
    NULL,
    p_trade_date,
    p_note,
    TRUE
  )
  RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'action', v_type,
    'symbol', v_symbol,
    'holding_shares', v_new_shares,
    'holding_cost_basis', v_new_cost,
    'holding_deleted', v_holding_deleted,
    'dime_balance', v_new_dime,
    'cash_delta', v_cash_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_synced_trade(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_synced_trade(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.prevent_synced_transaction_mutation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_synced_transaction_mutation()
  TO service_role;

COMMIT;
