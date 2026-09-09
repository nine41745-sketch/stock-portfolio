-- v1.21.0 — Transaction Ledger
-- Isolated ledger only: this migration does NOT mutate holdings, cost basis, cash balance, or historical AI data.
-- Sensitive money fields are encrypted with the same server-side pgcrypto key used by holdings.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.portfolio_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  symbol           TEXT,
  shares           NUMERIC(15,6),
  price_enc        TEXT,
  fee_enc          TEXT,
  amount_enc       TEXT,
  trade_date       DATE NOT NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT portfolio_transactions_type_check
    CHECK (transaction_type IN ('BUY', 'SELL', 'OPENING_POSITION', 'DIVIDEND', 'DEPOSIT', 'WITHDRAW')),
  CONSTRAINT portfolio_transactions_symbol_format
    CHECK (symbol IS NULL OR symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'),
  CONSTRAINT portfolio_transactions_shares_positive
    CHECK (shares IS NULL OR shares > 0),
  CONSTRAINT portfolio_transactions_note_length
    CHECK (note IS NULL OR char_length(note) <= 1000),
  CONSTRAINT portfolio_transactions_shape_check CHECK (
    (
      transaction_type IN ('BUY', 'SELL', 'OPENING_POSITION')
      AND symbol IS NOT NULL
      AND shares IS NOT NULL
      AND price_enc IS NOT NULL
      AND amount_enc IS NULL
    )
    OR (
      transaction_type = 'DIVIDEND'
      AND symbol IS NOT NULL
      AND shares IS NULL
      AND price_enc IS NULL
      AND amount_enc IS NOT NULL
    )
    OR (
      transaction_type IN ('DEPOSIT', 'WITHDRAW')
      AND symbol IS NULL
      AND shares IS NULL
      AND price_enc IS NULL
      AND amount_enc IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS portfolio_transactions_user_date_idx
  ON public.portfolio_transactions (user_id, trade_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS portfolio_transactions_user_symbol_idx
  ON public.portfolio_transactions (user_id, symbol, trade_date DESC)
  WHERE symbol IS NOT NULL;

ALTER TABLE public.portfolio_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portfolio_transactions_select_own ON public.portfolio_transactions;
CREATE POLICY portfolio_transactions_select_own
  ON public.portfolio_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS portfolio_transactions_insert_own ON public.portfolio_transactions;
CREATE POLICY portfolio_transactions_insert_own
  ON public.portfolio_transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS portfolio_transactions_update_own ON public.portfolio_transactions;
CREATE POLICY portfolio_transactions_update_own
  ON public.portfolio_transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS portfolio_transactions_delete_own ON public.portfolio_transactions;
CREATE POLICY portfolio_transactions_delete_own
  ON public.portfolio_transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS portfolio_transactions_updated_at ON public.portfolio_transactions;
CREATE TRIGGER portfolio_transactions_updated_at
  BEFORE UPDATE ON public.portfolio_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

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
  v_type TEXT := UPPER(TRIM(p_type));
  v_symbol TEXT := CASE WHEN p_symbol IS NULL THEN NULL ELSE UPPER(TRIM(p_symbol)) END;
  v_price_enc TEXT;
  v_fee_enc TEXT;
  v_amount_enc TEXT;
  v_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_trade_date IS NULL OR p_enc_key IS NULL OR p_enc_key = '' THEN
    RAISE EXCEPTION 'required transaction input missing';
  END IF;

  IF v_type NOT IN ('BUY', 'SELL', 'OPENING_POSITION', 'DIVIDEND', 'DEPOSIT', 'WITHDRAW') THEN
    RAISE EXCEPTION 'invalid transaction type';
  END IF;

  IF p_note IS NOT NULL AND char_length(p_note) > 1000 THEN
    RAISE EXCEPTION 'note too long';
  END IF;

  IF v_type IN ('BUY', 'SELL', 'OPENING_POSITION') THEN
    IF v_symbol IS NULL OR v_symbol !~ '^[A-Z0-9][A-Z0-9.-]{0,14}$' THEN
      RAISE EXCEPTION 'invalid symbol';
    END IF;
    IF p_shares IS NULL OR p_shares <= 0 OR p_price IS NULL OR p_price <= 0 THEN
      RAISE EXCEPTION 'shares and price must be positive';
    END IF;
    IF p_fee IS NOT NULL AND p_fee < 0 THEN
      RAISE EXCEPTION 'fee must not be negative';
    END IF;
    IF p_amount IS NOT NULL THEN
      RAISE EXCEPTION 'amount is not allowed for share transactions';
    END IF;
  ELSIF v_type = 'DIVIDEND' THEN
    IF v_symbol IS NULL OR v_symbol !~ '^[A-Z0-9][A-Z0-9.-]{0,14}$' THEN
      RAISE EXCEPTION 'invalid symbol';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'dividend amount must be positive';
    END IF;
    IF p_shares IS NOT NULL OR p_price IS NOT NULL OR p_fee IS NOT NULL THEN
      RAISE EXCEPTION 'share fields are not allowed for dividend';
    END IF;
  ELSE
    IF v_symbol IS NOT NULL OR p_shares IS NOT NULL OR p_price IS NOT NULL OR p_fee IS NOT NULL THEN
      RAISE EXCEPTION 'symbol/share fields are not allowed for cash transactions';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'cash amount must be positive';
    END IF;
  END IF;

  v_price_enc := CASE WHEN p_price IS NULL THEN NULL ELSE pgp_sym_encrypt(p_price::TEXT, p_enc_key)::TEXT END;
  v_fee_enc := CASE WHEN p_fee IS NULL THEN NULL ELSE pgp_sym_encrypt(p_fee::TEXT, p_enc_key)::TEXT END;
  v_amount_enc := CASE WHEN p_amount IS NULL THEN NULL ELSE pgp_sym_encrypt(p_amount::TEXT, p_enc_key)::TEXT END;

  IF p_id IS NULL THEN
    INSERT INTO public.portfolio_transactions (
      user_id, transaction_type, symbol, shares, price_enc, fee_enc, amount_enc, trade_date, note
    ) VALUES (
      p_user_id, v_type, v_symbol, p_shares, v_price_enc, v_fee_enc, v_amount_enc, p_trade_date, p_note
    )
    RETURNING id INTO v_id;
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
    WHERE id = p_id AND user_id = p_user_id
    RETURNING id INTO v_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'transaction not found';
    END IF;
  END IF;

  RETURN v_id;
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
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.transaction_type,
    t.symbol,
    t.shares,
    CASE WHEN t.price_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.price_enc::BYTEA, p_enc_key)::NUMERIC END,
    CASE WHEN t.fee_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.fee_enc::BYTEA, p_enc_key)::NUMERIC END,
    CASE WHEN t.amount_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(t.amount_enc::BYTEA, p_enc_key)::NUMERIC END,
    t.trade_date,
    t.note,
    t.created_at,
    t.updated_at
  FROM public.portfolio_transactions t
  WHERE t.user_id = p_user_id
  ORDER BY t.trade_date DESC, t.created_at DESC;
END;
$$;

-- The browser must never receive encryption/decryption capability. All reads/writes flow through authenticated API routes.
REVOKE ALL ON TABLE public.portfolio_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.portfolio_transactions TO service_role;

REVOKE ALL ON FUNCTION public.save_portfolio_transaction(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_decrypted_portfolio_transactions(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_portfolio_transaction(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, DATE, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_decrypted_portfolio_transactions(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
