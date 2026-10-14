# Supabase SQL bootstrap

Use the following order for a new disposable or newly provisioned database. Run each repository SQL file once with `psql` and stop on the first error (`ON_ERROR_STOP=1`). Do not apply these historical files to an existing database as a batch.

1. `schema.sql`
2. `migration_rpc_hardening.sql`
3. `migration_daily_analyses.sql`
4. `migration_scratchpad_notes.sql`
5. `migration_latest_analysis_wins_v1.15.0.sql`
6. `migration_security_data_integrity_v1.15.1.sql`
7. `migration_analysis_freshness_v1.16.0.sql`
8. `migration_watchlist_v1.18.0.sql`
9. `migration_transactions_v1.21.0.sql`
10. `migration_trade_plan_v1.23.0.sql`
11. `migration_pin_security.sql`
12. `migration_multi_portfolio_v1.27.0.sql`
13. `migration_transaction_autosync_v1.27.1.sql`
14. `migration_trade_plan_autosync_v1.30.0.sql`
15. `migration_allocation_targets_v1.31.0.sql`
16. `migration_bootstrap_repairs_v1.33.0.sql`
17. `verify_bootstrap_security.sql`
18. `test_portfolio_watchlist_fixtures_v1.35.0.sql` (Disposable Local only; synthetic owners, portfolios, and legacy row)
19. `migration_portfolio_watchlist_v1.35.0.sql`
20. `verify_portfolio_watchlist_v1.35.0.sql` (Disposable Local only; RLS/cross-owner/collection/legacy-preservation checks)

`migration_batch1_notes_and_daily_analyses.sql` is a historical one-off correction for a database that predates the current RPC hardening and daily-analysis migration. It is superseded in a fresh bootstrap by steps 2 and 3, and must not be run before `daily_analyses` exists.

The v1.35.0 migration is additive. It does not alter, copy, or assign rows from legacy `public.watchlist`. `rollback_portfolio_watchlist_v1.35.0.sql` removes only the new empty tables and refuses to proceed if any new table contains rows; a populated deployment requires an owner-reviewed data-preservation/roll-forward plan instead of destructive rollback. Cloud Apply remains a separately approved operation.

For a database that already ran the historical multi-portfolio migration, apply only `migration_bootstrap_repairs_v1.33.0.sql`, then run `verify_bootstrap_security.sql` and the repository's verification queries. The repair uses `CREATE OR REPLACE`, changes function settings and grants only, and preserves table rows. Take the usual database backup before applying any SQL to a non-disposable environment.
