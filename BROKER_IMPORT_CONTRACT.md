# Broker CSV Import — proposed contract (documentation only)

Status: Phase A discovery document. No parser, endpoint, migration or import persistence is implemented or authorized by this document.

## Supported first scope to approve

USD historical ledger records only, using a canonical template plus one broker adapter selected after reviewing an owner-supplied redacted sample. Do not claim DIME or another broker format is supported without verified fixtures. Options, shorts, corporate actions, transfers, FX conversion and gross-only dividends with ambiguous withholding are outside the first scope.

## Canonical draft v1

| Field | Contract |
| --- | --- |
| contract_version | `1`; reject unknown versions |
| kind | `LEDGER_HISTORY`; screenshot holdings use a separate `HOLDINGS_SNAPSHOT` contract |
| target_portfolio_id | Explicit owned portfolio selected at preview; revalidate at commit |
| source | Broker identifier + adapter/mapping version + optional non-sensitive account alias; never full account number |
| input_digest | Identifies repeat input within owner/portfolio/source scope; not proof of identity across different exports |
| row_index | Original source row number for review, not automatically chronological order |
| source_transaction_id | Stable broker ID where available; scope to owner/portfolio/source |
| currency | `USD`; reject unsupported currencies rather than use live FX on historical amounts |
| transaction_type | BUY, SELL, OPENING_POSITION, DIVIDEND, DEPOSIT or WITHDRAW, subject to existing transaction validation |
| symbol | Normalized symbol, required for shares/dividends; not inferred from company name alone |
| shares / price / fee / amount | Decimal strings, finite and within existing six-decimal validation; retain exact values until server normalization |
| trade_date | Valid YYYY-MM-DD with documented broker date semantics |
| occurred_at / source_sequence | Optional evidence of order; declare timezone/source. Never invent timestamps |
| dividend amount | Recorded cash amount from export; do not infer gross/net or discard withholding silently |
| note | Optional reviewed text; strip account/PII fields; never embed raw CSV |

Proposed bounded batches: 100 records per commit, explicit all-or-nothing semantics. Final payload/file limits need implementation tests and approval.

## Framework proposal

Browser parse → normalized draft → read-only server validation/duplicate preview → user confirmation → server revalidation → atomic service-only batch RPC → reconciliation report.

Preview must not create a default portfolio. Resolve an existing owned portfolio; missing schema/context blocks safely. Bind preview to target portfolio and relevant snapshot; a changed target must cause conflict/re-preview. Treat all client data as untrusted; enforce Auth/PIN, ownership, Origin/CSRF controls and payload limits at commit.

Historical import must write ledger-only and never replay `/api/trades` or `record_synced_trade`: those update current Holdings/DIME. Do not auto-create opening positions or overwrite existing/synced rows. Ledger reconciliation differences must be shown, not silently corrected.

Existing FIFO sorts date → created_at → UUID. Imported same-day executions require reviewed ordering metadata and behavioral tests; ambiguous historical order must be marked incomplete. File row order is not necessarily execution order. Preserve legacy behavior unless an approved change explicitly addresses it.

## Duplicate and atomicity rules

- Repeating a committed batch returns its original result without inserting twice, including timeout retries/concurrent submissions.
- Stable source transaction IDs support owner/portfolio/source-scoped uniqueness.
- Identical values with different source IDs may be genuine separate trades. Do not discard them by financial fingerprint.
- Overlapping exports without stable IDs need duplicate review; file digest alone cannot guarantee cross-export deduplication.
- An invalid row or failed write must roll back the whole bounded batch. Return inserted/skipped/rejected/conflict evidence.

## Data/privacy and future approval

No raw images/CSV in database, logs or browser persistence. Store minimal provenance; any persisted financial metadata must follow existing encryption boundaries, not plaintext notes. Public cache may hold public market data only; private results are owner/portfolio scoped and no-store.

Likely future schema: import batches/rows, scoped unique keys, optional ordering metadata, service-only atomic RPCs and read-only verification SQL. This is a proposal, not migration approval. Writing a migration, applying it to non-Production and applying it to Production each require separate scoped approval. No new Environment Variable, broker API or paid service is assumed.

Acceptance tests to approve: quoted CSV/BOM/date/decimal fixtures; unsupported currencies/actions; identical legitimate trades; repeat/overlap/concurrent imports; cross-user/portfolio/PIN checks; rollback; FIFO same-day order; existing Performance consistency; proof that historical import does not change Holdings/DIME. Live integration requires approved non-Production data/access.
