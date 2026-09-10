-- v1.23.0 — Trade Plan workspace
-- Stores entry/add/stop/target/budget/share planning only.
-- This migration does NOT mutate Holdings or Transaction Ledger and does NOT create BUY/SELL records.
-- Sensitive plan values and notes are encrypted at rest with the existing server-side pgcrypto key.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.trade_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'WAITING',
  source              TEXT NOT NULL DEFAULT 'MANUAL',
  entry_low_enc       TEXT NOT NULL,
  entry_high_enc      TEXT NOT NULL,
  add_zone_low_enc    TEXT,
  add_zone_high_enc   TEXT,
  stop_loss_enc       TEXT,
  target1_enc         TEXT,
  target2_enc         TEXT,
  budget_enc          TEXT,
  planned_shares_enc  TEXT,
  note_enc            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trade_plans_symbol_format
    CHECK (symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'),
  CONSTRAINT trade_plans_status_check
    CHECK (status IN ('WAITING', 'ENTERED', 'CANCELLED', 'CLOSED')),
  CONSTRAINT trade_plans_source_check
    CHECK (source IN ('MANUAL', 'STOCK_CHECK')),
  CONSTRAINT trade_plans_add_zone_shape
    CHECK ((add_zone_low_enc IS NULL) = (add_zone_high_enc IS NULL))
);

CREATE INDEX IF NOT EXISTS trade_plans_user_updated_idx
  ON public.trade_plans (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS trade_plans_user_symbol_idx
  ON public.trade_plans (user_id, symbol, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS trade_plans_one_active_symbol_idx
  ON public.trade_plans (user_id, symbol)
  WHERE status IN ('WAITING', 'ENTERED');

ALTER TABLE public.trade_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trade_plans_select_own ON public.trade_plans;
CREATE POLICY trade_plans_select_own
  ON public.trade_plans FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS trade_plans_insert_own ON public.trade_plans;
CREATE POLICY trade_plans_insert_own
  ON public.trade_plans FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS trade_plans_update_own ON public.trade_plans;
CREATE POLICY trade_plans_update_own
  ON public.trade_plans FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS trade_plans_delete_own ON public.trade_plans;
CREATE POLICY trade_plans_delete_own
  ON public.trade_plans FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trade_plans_updated_at ON public.trade_plans;
CREATE TRIGGER trade_plans_updated_at
  BEFORE UPDATE ON public.trade_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

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
  v_symbol TEXT := UPPER(TRIM(p_symbol));
  v_status TEXT := UPPER(TRIM(COALESCE(p_status, 'WAITING')));
  v_source TEXT := UPPER(TRIM(COALESCE(p_source, 'MANUAL')));
  v_entry_mid NUMERIC;
  v_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_enc_key IS NULL OR p_enc_key = '' THEN
    RAISE EXCEPTION 'required trade plan input missing';
  END IF;
  IF v_symbol IS NULL OR v_symbol !~ '^[A-Z0-9][A-Z0-9.-]{0,14}$' THEN
    RAISE EXCEPTION 'invalid symbol';
  END IF;
  IF v_status NOT IN ('WAITING', 'ENTERED', 'CANCELLED', 'CLOSED') THEN
    RAISE EXCEPTION 'invalid trade plan status';
  END IF;
  IF v_source NOT IN ('MANUAL', 'STOCK_CHECK') THEN
    RAISE EXCEPTION 'invalid trade plan source';
  END IF;
  IF p_entry_low IS NULL OR p_entry_low <= 0 OR p_entry_high IS NULL OR p_entry_high <= 0 OR p_entry_high < p_entry_low THEN
    RAISE EXCEPTION 'invalid planned entry zone';
  END IF;
  IF (p_add_zone_low IS NULL) <> (p_add_zone_high IS NULL) THEN
    RAISE EXCEPTION 'add zone must include both bounds';
  END IF;
  IF p_add_zone_low IS NOT NULL AND (p_add_zone_low <= 0 OR p_add_zone_high < p_add_zone_low) THEN
    RAISE EXCEPTION 'invalid add zone';
  END IF;
  IF p_budget IS NOT NULL AND p_budget <= 0 THEN
    RAISE EXCEPTION 'budget must be positive';
  END IF;
  IF p_planned_shares IS NOT NULL AND p_planned_shares <= 0 THEN
    RAISE EXCEPTION 'planned shares must be positive';
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 1000 THEN
    RAISE EXCEPTION 'note too long';
  END IF;

  v_entry_mid := (p_entry_low + p_entry_high) / 2;
  IF p_stop_loss IS NOT NULL AND (p_stop_loss <= 0 OR p_stop_loss >= v_entry_mid) THEN
    RAISE EXCEPTION 'stop loss must be below planned entry midpoint';
  END IF;
  IF p_target1 IS NOT NULL AND (p_target1 <= v_entry_mid) THEN
    RAISE EXCEPTION 'target1 must be above planned entry midpoint';
  END IF;
  IF p_target2 IS NOT NULL AND (p_target2 <= v_entry_mid) THEN
    RAISE EXCEPTION 'target2 must be above planned entry midpoint';
  END IF;
  IF p_target1 IS NOT NULL AND p_target2 IS NOT NULL AND p_target2 <= p_target1 THEN
    RAISE EXCEPTION 'target2 must be above target1';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.trade_plans (
      user_id, symbol, status, source,
      entry_low_enc, entry_high_enc, add_zone_low_enc, add_zone_high_enc,
      stop_loss_enc, target1_enc, target2_enc, budget_enc, planned_shares_enc, note_enc
    ) VALUES (
      p_user_id, v_symbol, v_status, v_source,
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
    )
    RETURNING id INTO v_id;
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
    WHERE id = p_id AND user_id = p_user_id
    RETURNING id INTO v_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'trade plan not found';
    END IF;
  END IF;

  RETURN v_id;
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
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.symbol,
    t.status,
    t.source,
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
    t.created_at,
    t.updated_at
  FROM public.trade_plans t
  WHERE t.user_id = p_user_id
  ORDER BY
    CASE t.status WHEN 'WAITING' THEN 0 WHEN 'ENTERED' THEN 1 WHEN 'CANCELLED' THEN 2 ELSE 3 END,
    t.updated_at DESC;
END;
$$;

-- Encryption/decryption remains server-side. Browser sessions cannot read ciphertext or invoke key-bearing RPCs.
REVOKE ALL ON TABLE public.trade_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trade_plans TO service_role;

REVOKE ALL ON FUNCTION public.save_trade_plan(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_decrypted_trade_plans(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_trade_plan(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_decrypted_trade_plans(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
