-- v1.35.0 — portfolio-scoped Watchlist, Collections, and deterministic rules.
-- Legacy public.watchlist is intentionally untouched. No rows are copied or assigned.
BEGIN;

CREATE TABLE IF NOT EXISTS public.portfolio_watchlist_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  portfolio_id UUID NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT portfolio_watchlist_collections_name_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 48),
  CONSTRAINT portfolio_watchlist_collections_scope_id_key
    UNIQUE (user_id, portfolio_id, id),
  CONSTRAINT portfolio_watchlist_collections_portfolio_fkey
    FOREIGN KEY (user_id, portfolio_id)
    REFERENCES public.portfolios (user_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_watchlist_collections_name_key
  ON public.portfolio_watchlist_collections (user_id, portfolio_id, lower(name));

CREATE TABLE IF NOT EXISTS public.portfolio_watchlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  portfolio_id UUID NOT NULL,
  collection_id UUID,
  symbol TEXT NOT NULL,
  target_price NUMERIC(15,4),
  note TEXT,
  alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT portfolio_watchlist_items_symbol_check
    CHECK (symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'),
  CONSTRAINT portfolio_watchlist_items_target_check
    CHECK (target_price IS NULL OR target_price > 0),
  CONSTRAINT portfolio_watchlist_items_note_check
    CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT portfolio_watchlist_items_scope_id_key
    UNIQUE (user_id, portfolio_id, id),
  CONSTRAINT portfolio_watchlist_items_scope_symbol_key
    UNIQUE (user_id, portfolio_id, symbol),
  CONSTRAINT portfolio_watchlist_items_portfolio_fkey
    FOREIGN KEY (user_id, portfolio_id)
    REFERENCES public.portfolios (user_id, id) ON DELETE CASCADE,
  CONSTRAINT portfolio_watchlist_items_collection_fkey
    FOREIGN KEY (user_id, portfolio_id, collection_id)
    REFERENCES public.portfolio_watchlist_collections (user_id, portfolio_id, id)
    ON DELETE SET NULL (collection_id)
);

CREATE INDEX IF NOT EXISTS portfolio_watchlist_items_scope_created_idx
  ON public.portfolio_watchlist_items (user_id, portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.portfolio_investment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  portfolio_id UUID NOT NULL,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  symbol TEXT,
  threshold NUMERIC(15,4) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT portfolio_investment_rules_name_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT portfolio_investment_rules_type_check CHECK (rule_type IN (
    'PRICE_AT_OR_BELOW', 'PRICE_AT_OR_ABOVE', 'DIME_AT_OR_BELOW',
    'CASH_AT_OR_BELOW', 'ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE'
  )),
  CONSTRAINT portfolio_investment_rules_symbol_check
    CHECK (symbol IS NULL OR symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'),
  CONSTRAINT portfolio_investment_rules_threshold_check CHECK (
    threshold > 0 AND
    (rule_type NOT IN ('ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE') OR threshold <= 100)
  ),
  CONSTRAINT portfolio_investment_rules_type_symbol_check CHECK (
    (rule_type IN ('PRICE_AT_OR_BELOW', 'PRICE_AT_OR_ABOVE', 'ALLOCATION_AT_OR_BELOW', 'POSITION_WEIGHT_AT_OR_ABOVE') AND symbol IS NOT NULL)
    OR (rule_type IN ('DIME_AT_OR_BELOW', 'CASH_AT_OR_BELOW') AND symbol IS NULL)
  ),
  CONSTRAINT portfolio_investment_rules_portfolio_fkey
    FOREIGN KEY (user_id, portfolio_id)
    REFERENCES public.portfolios (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS portfolio_investment_rules_scope_idx
  ON public.portfolio_investment_rules (user_id, portfolio_id, enabled);

ALTER TABLE public.portfolio_watchlist_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_investment_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portfolio_watchlist_collections_select_own ON public.portfolio_watchlist_collections;
CREATE POLICY portfolio_watchlist_collections_select_own ON public.portfolio_watchlist_collections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS portfolio_watchlist_collections_insert_own ON public.portfolio_watchlist_collections;
CREATE POLICY portfolio_watchlist_collections_insert_own ON public.portfolio_watchlist_collections
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS portfolio_watchlist_collections_update_own ON public.portfolio_watchlist_collections;
CREATE POLICY portfolio_watchlist_collections_update_own ON public.portfolio_watchlist_collections
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS portfolio_watchlist_collections_delete_own ON public.portfolio_watchlist_collections;
CREATE POLICY portfolio_watchlist_collections_delete_own ON public.portfolio_watchlist_collections
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS portfolio_watchlist_items_select_own ON public.portfolio_watchlist_items;
CREATE POLICY portfolio_watchlist_items_select_own ON public.portfolio_watchlist_items
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS portfolio_watchlist_items_insert_own ON public.portfolio_watchlist_items;
CREATE POLICY portfolio_watchlist_items_insert_own ON public.portfolio_watchlist_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS portfolio_watchlist_items_update_own ON public.portfolio_watchlist_items;
CREATE POLICY portfolio_watchlist_items_update_own ON public.portfolio_watchlist_items
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS portfolio_watchlist_items_delete_own ON public.portfolio_watchlist_items;
CREATE POLICY portfolio_watchlist_items_delete_own ON public.portfolio_watchlist_items
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS portfolio_investment_rules_select_own ON public.portfolio_investment_rules;
CREATE POLICY portfolio_investment_rules_select_own ON public.portfolio_investment_rules
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS portfolio_investment_rules_insert_own ON public.portfolio_investment_rules;
CREATE POLICY portfolio_investment_rules_insert_own ON public.portfolio_investment_rules
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS portfolio_investment_rules_update_own ON public.portfolio_investment_rules;
CREATE POLICY portfolio_investment_rules_update_own ON public.portfolio_investment_rules
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS portfolio_investment_rules_delete_own ON public.portfolio_investment_rules;
CREATE POLICY portfolio_investment_rules_delete_own ON public.portfolio_investment_rules
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.portfolio_watchlist_collections,
  public.portfolio_watchlist_items, public.portfolio_investment_rules FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.portfolio_watchlist_collections,
  public.portfolio_watchlist_items, public.portfolio_investment_rules TO authenticated, service_role;

DROP TRIGGER IF EXISTS portfolio_watchlist_collections_updated_at ON public.portfolio_watchlist_collections;
CREATE TRIGGER portfolio_watchlist_collections_updated_at BEFORE UPDATE ON public.portfolio_watchlist_collections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS portfolio_watchlist_items_updated_at ON public.portfolio_watchlist_items;
CREATE TRIGGER portfolio_watchlist_items_updated_at BEFORE UPDATE ON public.portfolio_watchlist_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS portfolio_investment_rules_updated_at ON public.portfolio_investment_rules;
CREATE TRIGGER portfolio_investment_rules_updated_at BEFORE UPDATE ON public.portfolio_investment_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

NOTIFY pgrst, 'reload schema';
COMMIT;
