#!/usr/bin/env bash
set -euo pipefail
db="${QA_DB_CONTAINER:-supabase_db_stock-portfolio-auth-browser-qa}"
if [[ -e supabase/.temp/project-ref ]]; then echo 'Cloud link metadata detected; refusing.' >&2; exit 1; fi
docker container inspect "$db" >/dev/null 2>&1 || { echo 'Expected disposable database container absent.' >&2; exit 1; }
files='schema.sql
migration_rpc_hardening.sql
migration_daily_analyses.sql
migration_scratchpad_notes.sql
migration_latest_analysis_wins_v1.15.0.sql
migration_security_data_integrity_v1.15.1.sql
migration_analysis_freshness_v1.16.0.sql
migration_watchlist_v1.18.0.sql
migration_transactions_v1.21.0.sql
migration_trade_plan_v1.23.0.sql
migration_pin_security.sql
migration_multi_portfolio_v1.27.0.sql
migration_transaction_autosync_v1.27.1.sql
migration_trade_plan_autosync_v1.30.0.sql
migration_allocation_targets_v1.31.0.sql
migration_bootstrap_repairs_v1.33.0.sql
verify_bootstrap_security.sql
test_portfolio_watchlist_fixtures_v1.35.0.sql
migration_portfolio_watchlist_v1.35.0.sql
verify_portfolio_watchlist_v1.35.0.sql'
while IFS= read -r file; do
  [[ -f "supabase/$file" ]] || { echo "Missing repository SQL: $file" >&2; exit 1; }
  docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "supabase/$file" >/dev/null 2>&1 || {
    echo "Disposable SQL bootstrap stopped at: $file" >&2; exit 1;
  }
done <<< "$files"

# Exercise idempotency, an actual guarded rollback, and roll-forward on the disposable database.
docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migration_portfolio_watchlist_v1.35.0.sql >/dev/null 2>&1 || {
  echo 'v1.35.0 migration idempotency check failed.' >&2; exit 1;
}
docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/verify_portfolio_watchlist_v1.35.0.sql >/dev/null 2>&1 || {
  echo 'v1.35.0 idempotency verification failed.' >&2; exit 1;
}
docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/rollback_portfolio_watchlist_v1.35.0.sql >/dev/null 2>&1 || {
  echo 'v1.35.0 actual rollback failed.' >&2; exit 1;
}
docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migration_portfolio_watchlist_v1.35.0.sql >/dev/null 2>&1 || {
  echo 'v1.35.0 roll-forward after rollback failed.' >&2; exit 1;
}
docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/verify_portfolio_watchlist_v1.35.0.sql >/dev/null 2>&1 || {
  echo 'v1.35.0 post-roll-forward verification failed.' >&2; exit 1;
}
echo 'Repository SQL bootstrap, portfolio isolation, idempotency, actual rollback, and roll-forward passed on disposable local database.'
