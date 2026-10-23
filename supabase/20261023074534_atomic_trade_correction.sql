-- Development candidate. No historical snapshot backfill; apply only after owner approval.
BEGIN;
CREATE SCHEMA IF NOT EXISTS trade_correction_internal;
REVOKE ALL ON SCHEMA trade_correction_internal FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS trade_correction_internal.execution_state (
  transaction_id uuid PRIMARY KEY REFERENCES public.portfolio_transactions(id),
  execution_seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  user_id uuid NOT NULL, portfolio_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0),
  before_holding jsonb, after_holding jsonb,
  before_dime numeric NOT NULL, after_dime numeric NOT NULL,
  after_dime_updated_at timestamptz, ledger_after jsonb NOT NULL,
  plan_id uuid, plan_before_status text, plan_after jsonb
);
CREATE INDEX IF NOT EXISTS execution_state_scope_seq ON trade_correction_internal.execution_state(user_id,portfolio_id,execution_seq DESC);
CREATE TABLE IF NOT EXISTS trade_correction_internal.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id uuid NOT NULL, user_id uuid NOT NULL, portfolio_id uuid NOT NULL,
  revision integer NOT NULL, reason_enc text NOT NULL,
  ledger_before jsonb NOT NULL, ledger_after jsonb NOT NULL,
  holding_before jsonb, holding_after jsonb,
  dime_before numeric NOT NULL, dime_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(transaction_id,revision)
);
CREATE TABLE IF NOT EXISTS trade_correction_internal.write_permit (
  backend_pid integer NOT NULL, transaction_xid bigint NOT NULL,
  transaction_id uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('UPDATE','DELETE')),
  PRIMARY KEY(backend_pid,transaction_xid,transaction_id,operation)
);
ALTER TABLE trade_correction_internal.execution_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_correction_internal.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_correction_internal.write_permit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA trade_correction_internal FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA trade_correction_internal FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION trade_correction_internal.protect_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'correction audit is append only'; END; $$;
REVOKE ALL ON FUNCTION trade_correction_internal.protect_audit() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS correction_audit_immutable ON trade_correction_internal.audit;
CREATE TRIGGER correction_audit_immutable BEFORE UPDATE OR DELETE ON trade_correction_internal.audit
FOR EACH ROW EXECUTE FUNCTION trade_correction_internal.protect_audit();

CREATE OR REPLACE FUNCTION public.prevent_synced_transaction_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF OLD.sync_portfolio THEN
    IF NOT EXISTS (SELECT 1 FROM trade_correction_internal.write_permit p
      WHERE p.backend_pid=pg_catalog.pg_backend_pid() AND p.transaction_xid=pg_catalog.txid_current()
        AND p.transaction_id=OLD.id AND p.operation=TG_OP) THEN
      RAISE EXCEPTION 'synced transaction is immutable';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.portfolio_id IS DISTINCT FROM OLD.portfolio_id OR NEW.transaction_type IS DISTINCT FROM OLD.transaction_type
      OR NEW.symbol IS DISTINCT FROM OLD.symbol OR NEW.trade_date IS DISTINCT FROM OLD.trade_date OR NEW.sync_portfolio IS DISTINCT FROM TRUE) THEN
      RAISE EXCEPTION 'correction cannot change trade identity';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.prevent_synced_transaction_mutation() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION trade_correction_internal.record_synced_trade_core(
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


REVOKE ALL ON FUNCTION trade_correction_internal.record_synced_trade_core(uuid,uuid,text,text,numeric,numeric,numeric,date,text,text) FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.record_synced_trade(
  p_user_id uuid,p_portfolio_id uuid,p_type text,p_symbol text,p_shares numeric,p_price numeric,p_fee numeric,
  p_trade_date date,p_note text,p_enc_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_before jsonb; v_after jsonb; v_dime numeric; v_after_dime numeric; v_after_time timestamptz; v_result jsonb; v_ledger jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.portfolios WHERE id=p_portfolio_id AND user_id=p_user_id) THEN RAISE EXCEPTION 'portfolio not found'; END IF;
  INSERT INTO public.user_settings(user_id,portfolio_id,dime_balance) VALUES(p_user_id,p_portfolio_id,0) ON CONFLICT(user_id,portfolio_id) DO NOTHING;
  SELECT coalesce(dime_balance,0) INTO v_dime FROM public.user_settings WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id FOR UPDATE;
  SELECT to_jsonb(h) INTO v_before FROM public.holdings h WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id AND symbol=upper(btrim(p_symbol)) FOR UPDATE;
  v_result := trade_correction_internal.record_synced_trade_core(p_user_id,p_portfolio_id,p_type,p_symbol,p_shares,p_price,p_fee,p_trade_date,p_note,p_enc_key);
  SELECT to_jsonb(h) INTO v_after FROM public.holdings h WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id AND symbol=upper(btrim(p_symbol));
  SELECT dime_balance,dime_updated_at INTO v_after_dime,v_after_time FROM public.user_settings WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id;
  SELECT to_jsonb(t) INTO v_ledger FROM public.portfolio_transactions t WHERE id=(v_result->>'transaction_id')::uuid;
  INSERT INTO trade_correction_internal.execution_state(transaction_id,user_id,portfolio_id,before_holding,after_holding,before_dime,after_dime,after_dime_updated_at,ledger_after)
  VALUES((v_result->>'transaction_id')::uuid,p_user_id,p_portfolio_id,v_before,v_after,v_dime,v_after_dime,v_after_time,v_ledger);
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.record_synced_trade(uuid,uuid,text,text,numeric,numeric,numeric,date,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_synced_trade(uuid,uuid,text,text,numeric,numeric,numeric,date,text,text) TO service_role;

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

  UPDATE trade_correction_internal.execution_state SET plan_id=p_trade_plan_id,plan_before_status=v_plan_status,plan_after=(SELECT to_jsonb(t) FROM public.trade_plans t WHERE t.id=p_trade_plan_id) WHERE transaction_id=(v_trade_result->>'transaction_id')::uuid;
  RETURN v_trade_result || jsonb_build_object('trade_plan_id', p_trade_plan_id, 'trade_plan_status', v_new_plan_status);
END;
$$;

REVOKE ALL ON FUNCTION public.record_trade_plan_trade(UUID, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_trade_plan_trade(UUID, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT) TO service_role;



CREATE OR REPLACE FUNCTION public.get_trade_correction_capability(p_user_id uuid,p_portfolio_id uuid,p_enc_key text)
RETURNS TABLE(transaction_id uuid,revision integer,shares_exact text,price_exact text,fee_exact text) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  WITH latest AS (
    SELECT * FROM trade_correction_internal.execution_state
    WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id ORDER BY execution_seq DESC LIMIT 1
  )
  SELECT s.transaction_id,s.revision,t.shares::text,
    extensions.pgp_sym_decrypt(t.price_enc::bytea,p_enc_key),
    coalesce(extensions.pgp_sym_decrypt(t.fee_enc::bytea,p_enc_key),'0') FROM latest s
  JOIN public.portfolios p ON p.id=s.portfolio_id AND p.user_id=s.user_id
  JOIN public.portfolio_transactions t ON t.id=s.transaction_id AND t.user_id=s.user_id AND t.portfolio_id=s.portfolio_id
  JOIN public.user_settings cash ON cash.user_id=s.user_id AND cash.portfolio_id=s.portfolio_id
  WHERE to_jsonb(t)=s.ledger_after AND coalesce(cash.dime_balance,0)=s.after_dime
    AND cash.dime_updated_at IS NOT DISTINCT FROM s.after_dime_updated_at
    AND (SELECT to_jsonb(h) FROM public.holdings h WHERE h.user_id=s.user_id AND h.portfolio_id=s.portfolio_id AND h.symbol=t.symbol) IS NOT DISTINCT FROM s.after_holding
    AND (s.plan_id IS NULL OR (SELECT to_jsonb(plan) FROM public.trade_plans plan WHERE plan.id=s.plan_id AND plan.user_id=s.user_id AND plan.portfolio_id=s.portfolio_id) IS NOT DISTINCT FROM s.plan_after)
$$;
REVOKE ALL ON FUNCTION public.get_trade_correction_capability(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_trade_correction_capability(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.correct_latest_synced_trade(
 p_user_id uuid,p_portfolio_id uuid,p_transaction_id uuid,p_expected_revision integer,
 p_shares numeric,p_price numeric,p_fee numeric,p_reason text,p_enc_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s trade_correction_internal.execution_state%ROWTYPE; v_old public.portfolio_transactions%ROWTYPE;
 v_temp public.portfolio_transactions%ROWTYPE; v_holding jsonb; v_plan jsonb; v_dime numeric; v_time timestamptz;
 v_result jsonb; v_after_holding jsonb; v_after_dime numeric; v_after_time timestamptz; v_after_ledger jsonb; v_status text;
BEGIN
 IF p_enc_key IS NULL OR p_enc_key='' OR p_expected_revision IS NULL OR p_expected_revision<0 OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 8 AND 500
  OR p_shares IS NULL OR p_shares<=0 OR p_shares>999999999.999999 OR p_price IS NULL OR p_price<=0 OR p_price>9999999999999.999999
  OR p_fee IS NULL OR p_fee<0 OR p_fee>9999999999999.999999 OR trunc(p_shares,6)<>p_shares OR trunc(p_price,6)<>p_price OR trunc(p_fee,6)<>p_fee THEN RAISE EXCEPTION 'invalid correction input'; END IF;
 SELECT * INTO s FROM trade_correction_internal.execution_state WHERE transaction_id=p_transaction_id AND user_id=p_user_id AND portfolio_id=p_portfolio_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'correction snapshot unavailable'; END IF;
 -- Same lock order as plan execution: plan, portfolio cash, then holdings/ledger.
 IF s.plan_id IS NOT NULL THEN
   SELECT to_jsonb(p) INTO v_plan FROM public.trade_plans p WHERE id=s.plan_id AND user_id=p_user_id AND portfolio_id=p_portfolio_id FOR UPDATE;
 END IF;
 SELECT coalesce(dime_balance,0),dime_updated_at INTO v_dime,v_time FROM public.user_settings WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'correction state changed'; END IF;
 SELECT * INTO s FROM trade_correction_internal.execution_state WHERE transaction_id=p_transaction_id AND user_id=p_user_id AND portfolio_id=p_portfolio_id FOR UPDATE;
 IF s.revision<>p_expected_revision THEN RAISE EXCEPTION 'correction revision changed'; END IF;
 IF EXISTS(SELECT 1 FROM trade_correction_internal.execution_state WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id AND execution_seq>s.execution_seq) THEN RAISE EXCEPTION 'correction not latest'; END IF;
 SELECT * INTO v_old FROM public.portfolio_transactions WHERE id=p_transaction_id AND user_id=p_user_id AND portfolio_id=p_portfolio_id FOR UPDATE;
 IF NOT FOUND OR NOT v_old.sync_portfolio THEN RAISE EXCEPTION 'correction trade unavailable'; END IF;
 SELECT to_jsonb(h) INTO v_holding FROM public.holdings h WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id AND symbol=v_old.symbol FOR UPDATE;
 IF v_holding IS DISTINCT FROM s.after_holding OR v_dime IS DISTINCT FROM s.after_dime OR v_time IS DISTINCT FROM s.after_dime_updated_at
    OR to_jsonb(v_old) IS DISTINCT FROM s.ledger_after OR (s.plan_id IS NOT NULL AND v_plan IS DISTINCT FROM s.plan_after) THEN RAISE EXCEPTION 'correction state changed'; END IF;
 IF s.before_holding IS NOT NULL THEN
   INSERT INTO public.holdings SELECT * FROM jsonb_populate_record(NULL::public.holdings,s.before_holding)
   ON CONFLICT(id) DO UPDATE SET shares=excluded.shares,cost_basis_enc=excluded.cost_basis_enc,notes=excluded.notes,updated_at=excluded.updated_at;
 ELSE
   -- Avoid deleting a newly opened holding and cascading its analysis records.
   UPDATE public.holdings SET shares=0,cost_basis_enc=NULL WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id AND symbol=v_old.symbol;
 END IF;
 UPDATE public.user_settings SET dime_balance=s.before_dime,dime_updated_at=clock_timestamp() WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id;
 v_result := trade_correction_internal.record_synced_trade_core(p_user_id,p_portfolio_id,v_old.transaction_type,v_old.symbol,p_shares,p_price,p_fee,v_old.trade_date,v_old.note,p_enc_key);
 SELECT * INTO STRICT v_temp FROM public.portfolio_transactions WHERE id=(v_result->>'transaction_id')::uuid;
 INSERT INTO trade_correction_internal.write_permit VALUES(pg_backend_pid(),txid_current(),v_temp.id,'DELETE'),(pg_backend_pid(),txid_current(),v_old.id,'UPDATE');
 DELETE FROM public.portfolio_transactions WHERE id=v_temp.id;
 UPDATE public.portfolio_transactions SET shares=v_temp.shares,price_enc=v_temp.price_enc,fee_enc=v_temp.fee_enc,updated_at=clock_timestamp() WHERE id=v_old.id;
 DELETE FROM trade_correction_internal.write_permit WHERE backend_pid=pg_backend_pid() AND transaction_xid=txid_current();
 IF s.plan_id IS NOT NULL THEN
   v_status := CASE WHEN v_old.transaction_type='SELL' AND (v_result->>'holding_shares')::numeric<=0 THEN 'CLOSED' ELSE 'ENTERED' END;
   UPDATE public.trade_plans SET status=v_status,updated_at=clock_timestamp() WHERE id=s.plan_id AND user_id=p_user_id AND portfolio_id=p_portfolio_id;
   SELECT to_jsonb(p) INTO v_plan FROM public.trade_plans p WHERE id=s.plan_id;
 END IF;
 SELECT to_jsonb(h) INTO v_after_holding FROM public.holdings h WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id AND symbol=v_old.symbol;
 SELECT dime_balance,dime_updated_at INTO v_after_dime,v_after_time FROM public.user_settings WHERE user_id=p_user_id AND portfolio_id=p_portfolio_id;
 SELECT to_jsonb(t) INTO v_after_ledger FROM public.portfolio_transactions t WHERE id=v_old.id;
 INSERT INTO trade_correction_internal.audit(transaction_id,user_id,portfolio_id,revision,reason_enc,ledger_before,ledger_after,holding_before,holding_after,dime_before,dime_after)
 VALUES(v_old.id,p_user_id,p_portfolio_id,s.revision+1,extensions.pgp_sym_encrypt(btrim(p_reason),p_enc_key)::text,to_jsonb(v_old),v_after_ledger,v_holding,v_after_holding,v_dime,v_after_dime);
 UPDATE trade_correction_internal.execution_state SET revision=s.revision+1,after_holding=v_after_holding,after_dime=v_after_dime,after_dime_updated_at=v_after_time,ledger_after=v_after_ledger,plan_after=v_plan WHERE transaction_id=v_old.id;
 RETURN v_result || jsonb_build_object('transaction_id',v_old.id,'correction_revision',s.revision+1,'trade_plan_status',v_status);
END; $$;
REVOKE ALL ON FUNCTION public.correct_latest_synced_trade(uuid,uuid,uuid,integer,numeric,numeric,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.correct_latest_synced_trade(uuid,uuid,uuid,integer,numeric,numeric,numeric,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
