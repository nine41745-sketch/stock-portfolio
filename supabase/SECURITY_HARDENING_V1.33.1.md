# v1.33.1 Security Hardening (Local Validation Package)

This package contains a narrow forward migration for an existing Supabase
installation. It changes only function ACLs and the `update_updated_at()`
function setting. It does not replace either function body, edit event-trigger
registrations, change policies, or touch table data.

## Preconditions

- Start from a verified backup and compare function definitions, ACLs, and
  event-trigger registrations with the target first.
- `public.rls_auto_enable()` must already exist as a zero-argument,
  `SECURITY DEFINER` function returning `event_trigger`, and at least one
  enabled `ensure_rls` event trigger must reference it. The migration fails
  closed if any precondition is absent.
- Run `inspect_security_hardening_baseline_v1.33.1.sql` before the migration.
  It reports both function definitions, stored/expanded `proacl`, effective
  privileges (including role membership), function settings, and the event-trigger registration.
- Inspect the captured `rls_auto_enable()` body and every referenced dependency before
  constraining its path; the local fixture below is synthetic and is not proof of
  the exact Cloud function body or ACL baseline.
- Run only against a disposable/non-production database during this phase.
  Never use a Production URL, credential, or data fixture.
- The committed fresh-bootstrap SQL does not define `rls_auto_enable()` or its
  event trigger. A clean local bootstrap therefore needs an isolated test
  fixture/provisioning step before this migration can be exercised. Do not
  silently skip the migration or claim fresh-bootstrap coverage without it.

## Synthetic event-trigger fixture

`tests/fixtures/security_hardening_event_trigger_v1.33.1.sql` intentionally installs a local-only representative function and grants for a disposable Supabase/PostgreSQL database. It tests the migration mechanics and automatic-RLS behavior; it is not a copy or assertion of a Production function definition. Never run it against Cloud or Production.

## Apply and verify locally

1. Verify the database endpoint is local and that Docker/Supabase CLI targets
   the disposable instance.
2. Review and retain the baseline output. Apply
   `migration_security_hardening_v1.33.1.sql` with stop-on-error enabled.
3. Run `verify_security_hardening_v1.33.1.sql`. It checks event-trigger
   signature/security/ACL, confirms an enabled trigger still turns on RLS for
   a newly created `public` table, checks all active public triggers using
   `update_updated_at()`, exercises timestamp behavior, and verifies rollback.
4. Run the repository Auth/PIN, RPC/portfolio isolation, ledger, dividend and
   DCA regression suites using synthetic fixtures.
5. Run the read-only snapshot again and compare the outputs. The migration
   revokes PUBLIC, anon, authenticated, and authenticator access, while
   preserving service_role's effective EXECUTE privilege if it existed before
   the change and leaving other explicit internal-role ACLs untouched. It
   constrains both function search paths to `pg_catalog`.

The verification script wraps its probes in a transaction and ends with
`ROLLBACK`; the probe table and temporary test rows are discarded.

## Rollback

`rollback_security_hardening_v1.33.1.sql` requires the exact pre-change ACL
array and function search-path settings from that same database's snapshot.
It removes current explicit grants and reconstructs the captured effective ACL, then
restores and asserts search-path semantics. Grantor identity and NULL-versus-explicit
`proacl` representation are not restored byte-for-byte; review the catalog diff. The script exits before changing anything
when snapshot variables are missing. Populate `baseline_rls_acl` from
`effective_acl_snapshot`; for each function populate the corresponding
`*_search_path_present` and `*_search_path_value` from the same snapshot
output (use an empty value when the setting was absent). This intentionally
restores the prior security posture, which may reopen the original finding.
Use only after a confirmed regression and a separate rollback decision.

## Cloud rollout boundary

Nothing in this package authorizes applying the migration or rollback to
Supabase Cloud. Cloud rollout requires a separate approval, a tested
Non-Production target, a reviewed catalog diff, a maintenance/rollback window,
and post-change Auth/RLS/RPC verification.
