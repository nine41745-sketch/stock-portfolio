-- TEST FIXTURE ONLY. Apply solely through the owned disposable Docker harness.
-- Observed catalog: 2026-10-23. No Production records or credentials are copied.
-- This reproduces scoped catalog differences, not a complete Production clone.
BEGIN;
ALTER TABLE public.user_settings
  ALTER COLUMN dime_balance TYPE numeric,
  ALTER COLUMN dime_balance DROP NOT NULL,
  ALTER COLUMN initial_capital TYPE numeric,
  ALTER COLUMN initial_capital DROP NOT NULL,
  ALTER COLUMN cash_balance DROP NOT NULL,
  ALTER COLUMN updated_at DROP NOT NULL,
  DROP COLUMN created_at;
GRANT ALL ON public.holdings, public.user_settings TO anon, authenticated, service_role;
REVOKE ALL ON public.portfolio_transactions, public.trade_plans FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.portfolio_transactions, public.trade_plans TO service_role;
REVOKE ALL ON public.portfolios FROM PUBLIC, anon;
GRANT ALL ON public.portfolios TO authenticated, service_role;
CREATE POLICY "Users can manage own settings" ON public.user_settings
  FOR ALL TO PUBLIC USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
COMMIT;
