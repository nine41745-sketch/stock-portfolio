-- v1.30.0 Trade Plan -> Transaction Auto Sync
-- Additive migration only: no table/column changes.
-- One database function call owns the whole transaction so Ledger + Holdings + Dime + Trade Plan status roll back together.

CREATE OR REPLACE FUNCTION public.record_trade_plan_trade(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_trade_plan_id UUID,
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
SET search_path = ''
AS $$
DECLARE
  v_type TEXT := UPPER(BTRIM(p_type));
  v_symbol TEXT := UPPER(BTRIM(p_symbol));
  v_plan_symbol TEXT;
  v_plan_status TEXT;
  v_new_plan_status TEXT;
  v_trade_result JSONB;
  v_remaining_shares NUMERIC;
BEGIN
  IF p_user_id IS NULL OR p_portfolio_id IS NULL OR p_trade_plan_id IS NULL THEN RAISE EXCEPTION 'required trade plan execution input missing'; END IF;
  IF v_type NOT IN ('BUY', 'SELL') THEN RAISE EXCEPTION 'invalid trade type'; END IF;

  SELECT t.symbol, t.status INTO v_plan_symbol, v_plan_status
  FROM public.trade_plans t
  WHERE t.id = p_trade_plan_id AND t.user_id = p_user_id AND t.portfolio_id = p_portfolio_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'trade plan not found'; END IF;
  IF v_symbol IS NULL OR v_symbol <> v_plan_symbol THEN RAISE EXCEPTION 'trade plan symbol mismatch'; END IF;
  IF v_plan_status IN ('CANCELLED', 'CLOSED') THEN RAISE EXCEPTION 'trade plan inactive'; END IF;
  IF v_type = 'SELL' AND v_plan_status <> 'ENTERED' THEN RAISE EXCEPTION 'trade plan not entered'; END IF;

  SELECT public.record_synced_trade(
    p_user_id, p_portfolio_id, v_type, v_plan_symbol, p_shares, p_price, p_fee, p_trade_date, p_note, p_enc_key
  ) INTO v_trade_result;

  v_remaining_shares := COALESCE(NULLIF(v_trade_result->>'holding_shares', '')::NUMERIC, 0);
  IF v_type = 'BUY' THEN
    v_new_plan_status := 'ENTERED';
  ELSIF v_remaining_shares <= 0 THEN
    v_new_plan_status := 'CLOSED';
  ELSE
    v_new_plan_status := 'ENTERED';
  END IF;

  UPDATE public.trade_plans
  SET status = v_new_plan_status, updated_at = NOW()
  WHERE id = p_trade_plan_id AND user_id = p_user_id AND portfolio_id = p_portfolio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'trade plan not found'; END IF;

  RETURN v_trade_result || jsonb_build_object('trade_plan_id', p_trade_plan_id, 'trade_plan_status', v_new_plan_status);
END;
$$;

REVOKE ALL ON FUNCTION public.record_trade_plan_trade(UUID, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_trade_plan_trade(UUID, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
