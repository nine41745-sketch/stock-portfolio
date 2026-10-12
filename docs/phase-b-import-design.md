# v1.33.0 Phase B Import Preview and Persistence Proposal

Status: Local development proposal. The current implementation is preview-only. No broker-specific adapter, import API, migration, or database write is included.

## Final local refinement and integration review (2026-10-13)

The owner authorized local-only Phase B refinements, synthetic UI/OCR checks, and read-only environment inventory. This approval does not authorize commit, push, merge, deployment, live database tests, or persistence.

### Theme and keyboard acceptance

- Warning and rejected-row text uses the existing `amber-300` theme mapping; secondary copy uses `gray-400`. Error text keeps the existing `red-300` mapping. Primary OCR hover uses `blue-700` to preserve text contrast. Focus outlines are scoped to `.import-preview`; unrelated feature themes are unchanged.
- Tabs support ArrowLeft/ArrowRight, Home/End, a single tab stop, linked tab/panel IDs, and visible focus. File inputs remain visible and keyboard reachable. Preview table regions can receive keyboard focus. Explicit mobile grid tracks prevent a wide table from widening the page.
- Local synthetic component browser checks cover light/dark at 360px and 1280px. Warning contrast measured 6.57:1 light / 11.51:1 dark; error contrast 7.60:1 light / 9.29:1 dark; selected-tab contrast 5.17:1. This is component QA, not authenticated application or database acceptance.

### Security assessment

- Tesseract.js and its core are pinned by the lockfile to 7.0.0. Browser worker scripts and core load from versioned jsDelivr URLs; English model data loads from the 4.0.0 trained-data package. A synthetic live OCR run recognized NVDA, with external GET requests for engine/model assets and no image request body. IndexedDB held only `./eng.traineddata`; Local/Session Storage were empty and clearing the page removed the image and OCR text.
- CDN-provided JavaScript remains a supply-chain trust boundary. Versioned URLs are not integrity verification. Do not claim fully offline support: first use needs engine/model resources; self-hosting and offline acceptance are separate future work.
- Full audit explicitly includes dev dependencies (`npm audit --include=dev --json`). Seven High package findings trace to braces 3.0.3, GHSA-vfj7-8cjw-p6xm / CVE-2026-93687: deeply nested brace patterns can cause Node stack-exhaustion denial of service. Paths include `tailwindcss -> chokidar -> braces`, `tailwindcss -> fast-glob/micromatch -> braces`, and `eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces`.
- No import content is used as a glob pattern. The identified exposure is development/build availability if an attacker can supply patterns to these tools; no deployed import route to braces was found. Production audit reports zero findings. This does not reclassify the upstream High severity or establish universal runtime safety.
- The [reviewed braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no patched braces release. npm proposes Tailwind 4.3.3 or ESLint config 14.2.35 as breaking changes; neither is an approved or validated remediation for this repository. Dependencies and security gates remain unchanged. A separate maintenance approval is needed for remediation.
- Formula-like CSV fields are rejected; equal normalized rows remain within-file duplicate candidates. No ledger lookup, cross-file deduplication, authenticated database integration, or persistence is claimed.

### Integration plan without a branch merge/rebase

1. Remote main remains `d19499742e4244a89f6c4d8a24bf22fb87726123`; Phase A remains `43002f77910d4f6ac17bafb76c2f237ec614ce5f` in PR #59. Phase B is based on main and currently does not contain Phase A.
2. After separately approved Phase A acceptance/merge, update the Phase B base while preserving its changes. `package.json` has an overlapping `test:critical` line: retain every baseline runner, then both `node scripts/test-phase-a.mjs` and `node scripts/test-import-preview.mjs`.
3. Phase A does not change package-lock, navigation, proxy, or the freshness guard. Preserve the Phase B Tesseract dependency/lockfile additions and Import Preview tab; if upstream dependencies change later, regenerate the lockfile under Node 22 instead of hand-merging resolutions.
4. Preserve Phase A `AGENTS.md`, `ROADMAP.md`, broker contract, API and planner changes. Add an owner-authorized Phase B progress note later; do not erase the recorded Phase A approval history or treat preview-only imports as completed persistence.
5. Preserve the existing Auth/PIN proxy and inactivity lock. The `/imports` freshness-read exemption is not an authentication exemption. No portfolio API is called by the preview component.
6. A temporary source snapshot combining the reviewed Phase A files and local Phase B files passed typecheck and all regression runners, including Phase A 30/30, Market Intelligence 11/11, and Import Preview assertions. No Git branch was merged/rebased. This does not replace future exact-commit CI or live acceptance.

### Non-Production readiness and approval bundle

- Read-only inventory found Stock Portfolio project `etzoreksiwcbuwtbxozv`, ACTIVE_HEALTHY, with no development branches. Inventory does not identify its production/preview role or show deployment-to-database mapping. Treat this project as production-risk; neither a production mapping nor a safe Non-Production target is confirmed. No key values, SQL, RPC, tables, or records were inspected.
- Prefer a separately approved disposable local Supabase stack with synthetic users/portfolios and reviewed repository schema: no cloud project or Vercel preview is needed. Confirm Docker/CLI availability and approve local schema setup, fixture creation, test scope, and cleanup before starting it.
- If a cloud target is chosen, the owner must identify the exact test project/ref and organization, approve schema/fixture lifecycle and Auth/PIN/RLS/RPC tests, and confirm cost/permissions through official UI. Do not copy production data or secrets.
- The account inventory showed two active projects. [Free Plan allows two active free projects](https://supabase.com/docs/guides/platform/billing-on-supabase) across Owner/Admin organizations, but the current billing plan and remaining quota were not established. Do not pause, repurpose, or alter the other project. [Branch compute is separately billed](https://supabase.com/docs/guides/platform/manage-your-usage/branching); no cost-bearing resource was created.

## Current local preview contract

- Screenshot import accepts JPG, PNG, or WebP up to 5 MB and 16 megapixels. OCR runs in a browser worker using the pinned Tesseract.js package and English recognition data. The image and OCR text are held in page memory, are never sent to an OCR service, are not written to browser storage, and are not sent to an application API. The worker is terminated after each run. The inert English trained-data model may be cached in IndexedDB to avoid repeated downloads; this cache never contains an image or recognized text.
- The first synthetic screenshot layout is one row per line: `SYMBOL SHARES PRICE YYYY-MM-DD`. It produces a Holdings Snapshot preview only. Price is labeled as observed price and is not cost basis. Unrecognized rows remain visible with line and reason. OCR output is editable before parsing.
- CSV preview accepts the canonical columns `transaction_type,symbol,shares,price,fee,amount,trade_date,currency`, USD only, up to 1 MB and 500 logical data rows. It supports UTF-8 BOM, quoted fields, escaped quotes, and quoted newlines. Duplicate headers, malformed quoting, wrong field counts, unsupported columns, formula-like values, invalid currency, and invalid transactions fail closed or appear as rejected rows.
- Duplicate detection is limited to normalized rows inside the selected file. A matching row is labeled as a candidate and remains in the preview. Existing ledger data is not queried, so this is not duplicate detection against a portfolio.
- The authenticated `/imports` page is covered by the existing Auth/PIN proxy boundary. It does not call portfolio, holdings, DIME, or transaction APIs. It does not write Holdings, DIME, or Transaction Ledger data. It does not perform trades.

## Proposed future persistence design (not implemented)

Persistence needs a separately approved Non-Production database and migration. It must be designed for a user-confirmed CSV ledger import, not for applying a screenshot snapshot to Holdings.

### Tables and constraints

1. `portfolio_import_batches`: UUID primary key; `user_id`; `portfolio_id`; source kind; canonical schema version; idempotency UUID; digest of normalized rows only; row counts; state (`committed` or `rolled_back`); timestamps. Enforce a composite ownership reference to `(user_id, portfolio_id)` and unique `(user_id, portfolio_id, idempotency_key)`. Do not store raw CSV, screenshot, OCR text, account number, or broker credentials.
2. `portfolio_import_items`: batch ID, transaction ID, original row number, optional broker execution timestamp and opaque external-reference hash, plus normalized fingerprint hash. Enforce unique `(batch_id, row_number)` and transaction ownership/portfolio consistency with composite foreign keys. Do not create a globally unique transaction fingerprint: two equal trades can be legitimate.
3. Add nullable provenance linkage to `portfolio_transactions` only if a composite foreign key cannot be expressed cleanly from the mapping table. Preserve all existing rows and behavior.

### Atomic RPC and isolation

- The server authenticates with `getUser()`, verifies the session-bound PIN, validates CSRF/origin policy, resolves the active owned portfolio, and caps batch size before calling the RPC. Ignore user-provided `user_id`; derive it from the authenticated identity.
- Use one service-only RPC transaction to validate ownership, lock the portfolio-scoped idempotency key, detect retry, inspect existing duplicate candidates in that same user/portfolio, insert the batch/items and ledger rows, and return per-row results. Any invalid or ambiguous row rejects the entire confirmed batch unless a later product decision explicitly approves partial imports.
- Prefer `SECURITY INVOKER` with the existing service-role server boundary. If `SECURITY DEFINER` is required by the verified grants, pin `search_path` to empty, schema-qualify every object, revoke execution from `PUBLIC`, `anon`, and `authenticated`, and grant only `service_role`. Inspect actual grants and RLS in the approved non-Production project before final SQL.
- Imported BUY/SELL history remains manual ledger history (`sync_portfolio=false`). It must never call the trade synchronization RPC and must never change Holdings or DIME. Applying a Screenshot Snapshot to Holdings is a separate product decision and separate mutation design.
- A retry with the same scoped idempotency key returns the original batch result without inserting again. A normalized duplicate fingerprint raises a candidate for explicit confirmation; it is not an automatic drop rule.

### Historical FIFO ordering

The current performance code orders same-day transactions by `trade_date`, then database `created_at`, then `id`. Import time is not a valid substitute for historical trade order. Store optional broker execution timestamp and source row sequence as provenance. Update the ledger RPC and FIFO reader to use `trade_date`, known execution time, source row sequence, then the existing `created_at`/`id` fallback. If a broker supplies only a date and multiple same-day trades are unordered, preserve file sequence and disclose that assumption. Never rewrite old `created_at` values.

### Duplicate review and errors

- Calculate fingerprints from normalized transaction fields within the user and portfolio scope. Salted keyed hashes are preferable if fingerprints contain low-entropy financial values; the key belongs in server-managed secret storage and is outside this local proposal.
- Return candidate row numbers and non-sensitive reasons. Do not log imported values, source rows, raw file contents, OCR output, or account identifiers.
- Validate decimal precision, date, symbol, transaction-type-specific required fields, currency, size, and row count on both client and server. The server is authoritative.

### Rollback

- Mark the batch as rolled back and remove only its linked imported ledger rows in one guarded RPC, provided every linked row is unchanged and no other record depends on it. Do not reverse or delete unrelated rows and do not call a trade sync function.
- If any row has since been edited or referenced, fail closed and require a separately reviewed correction flow. Keep batch metadata and row-number hashes for audit while retaining no source file.
- Verify before/after ledger counts and reconciliation on a disposable Non-Production fixture. A migration rollback removes only newly added structures after imported test batches have been removed; never drop or reconstruct existing ledger data.

## Test plan before any live persistence approval

Use an identified, isolated Non-Production Supabase project with synthetic fixtures and two synthetic users, each owning two portfolios. Verify Auth/PIN, cross-user and cross-portfolio denial, service-role grants, RLS, RPC atomic rollback, idempotent retries, duplicate candidates, same-day FIFO ordering, size boundaries, and no Holdings/DIME changes. Capture metadata and counts only; do not use Production credentials or records. Stop before the test until the owner approves the exact target, fixture lifecycle, and permissions.
