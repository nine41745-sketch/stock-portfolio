# Trading Journal Persistence Proposal — v1.38.0

This document proposes a future design only. v1.38.0 does not add a table, migration, RPC, or write API.

## Proposed record shape

An eventual journal record should bind to `user_id`, `portfolio_id`, and either a `transaction_id` or an explicitly defined closed-trade group. Store the four user-authored fields (rationale, plan, execution review, lessons learned), timestamps, and a monotonically increasing revision. Prefer a unique constraint that prevents duplicate notes for the same user/portfolio/transaction association.

## Security requirements before implementation

- Keep ownership and portfolio predicates in every read/write path; test cross-account and cross-portfolio denial.
- Apply the same PIN/session gate as other sensitive portfolio data.
- Encrypt note content using the established application encryption pattern; never introduce plaintext browser persistence as a fallback.
- Require `expectedRevision` on writes to prevent stale-tab overwrites; define create revision and conflict responses.
- Define deletion, export, retention, and recovery behavior before accepting durable private notes.
- Verify RLS and RPC authorization against a disposable local database before any separately approved Cloud migration.

Schema design, migration, execution, and Cloud verification require distinct scoped approval. This proposal does not authorize them.
