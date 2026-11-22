-- v1.41.50 Analysis cron run status
-- Additive schema: one status table written only by the cron routes (service role) and readable by the owner.
-- One row per cron round x user/portfolio: started/finished time, counts and a short error summary.
-- No existing table, row, function or policy is changed. Cloud Apply is a separately approved operation.

CREATE TABLE IF NOT EXISTS public.analysis_cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  run_date DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  holdings INTEGER,
  processed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  rate_limited INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analysis_cron_runs_mode_check
    CHECK (mode IN ('DAILY_POST_CLOSE', 'PREMARKET_TRIGGER')),
  CONSTRAINT analysis_cron_runs_status_check
    CHECK (status IN ('ok', 'partial', 'failed', 'rate_limited', 'no_work')),
  CONSTRAINT analysis_cron_runs_counts_check
    CHECK (processed >= 0 AND failed >= 0 AND rate_limited >= 0 AND (holdings IS NULL OR holdings >= 0)),
  CONSTRAINT analysis_cron_runs_time_check
    CHECK (finished_at >= started_at),
  CONSTRAINT analysis_cron_runs_error_summary_check
    CHECK (error_summary IS NULL OR char_length(error_summary) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_analysis_cron_runs_scope_date
  ON public.analysis_cron_runs (user_id, portfolio_id, mode, run_date DESC, finished_at DESC);

ALTER TABLE public.analysis_cron_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analysis_cron_runs_select_own ON public.analysis_cron_runs;
CREATE POLICY analysis_cron_runs_select_own
ON public.analysis_cron_runs
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  AND (
    portfolio_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.portfolios p
      WHERE p.id = portfolio_id
        AND p.user_id = auth.uid()
    )
  )
);

-- Owners can only read; only the cron routes (service role) insert. No UPDATE/DELETE grants for app roles.
REVOKE ALL ON TABLE public.analysis_cron_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.analysis_cron_runs TO authenticated;
GRANT SELECT, INSERT ON TABLE public.analysis_cron_runs TO service_role;

NOTIFY pgrst, 'reload schema';
