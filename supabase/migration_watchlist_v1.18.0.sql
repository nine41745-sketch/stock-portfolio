-- v1.18.0 — Watchlist / Entry Candidates
-- Persistent per-user list of stocks being considered for entry.

CREATE TABLE IF NOT EXISTS public.watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  target_price NUMERIC(15,4),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT watchlist_user_symbol_key UNIQUE (user_id, symbol),
  CONSTRAINT watchlist_symbol_format CHECK (symbol ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'),
  CONSTRAINT watchlist_target_price_positive CHECK (target_price IS NULL OR target_price > 0),
  CONSTRAINT watchlist_note_length CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS watchlist_user_created_idx
  ON public.watchlist (user_id, created_at DESC);

ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS watchlist_select_own ON public.watchlist;
CREATE POLICY watchlist_select_own
  ON public.watchlist
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlist_insert_own ON public.watchlist;
CREATE POLICY watchlist_insert_own
  ON public.watchlist
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlist_update_own ON public.watchlist;
CREATE POLICY watchlist_update_own
  ON public.watchlist
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlist_delete_own ON public.watchlist;
CREATE POLICY watchlist_delete_own
  ON public.watchlist
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist TO authenticated;

NOTIFY pgrst, 'reload schema';
