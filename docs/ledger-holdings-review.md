# Ledger and Holdings reconciliation review

## Scope and conclusions

Reviewed against main/Production `0a5ab7e4161f89d570620e426eeab9f83089c631`. Source analysis, synthetic tests and owner-authorized read-only browser observations are distinct evidence. No Production database queries, secret reads, stored-data edits or trade writes were performed.

The browser's Transactions comparison and Performance warning agree that a historical position differs. Recomputing its displayed opening quantity plus BUY minus two SELL quantities reproduces the displayed Ledger total. This is a genuine stored-history discrepancy, not explained by floating-point tolerance alone. UI evidence cannot identify whether the opening balance, a historical trade, or Holdings is wrong. A rounded opening balance is one hypothesis only. Do not overwrite Holdings, inject a balancing trade, or backfill a snapshot to silence the warning.

## Confirmed code bug and local fix

`lib/performance.ts` used epsilon 0.000001 for FIFO consumption and zero-position decisions, although one valid NUMERIC(15,6) share unit is exactly 0.000001. A one-unit SELL could be ignored and its cost omitted; a valid remainder could be discarded; a one-unit oversell could be accepted. Reduce computational tolerance to 0.000000001, below the persisted share quantum. This changes read-only calculations only, not database values, trade execution or security rules.

Synthetic regressions cover micro-share BUY/SELL FIFO cost and realized P/L, retained remainders, rejected micro-share oversells without lot mutation, genuine fractional discrepancy warnings, and historical pricing completeness. Existing ordinary FIFO, cash flow and portfolio-performance tests remain in place. Tests failed on the old tolerance before the fix and passed after it.

## Remaining owner evidence before data correction

1. Compare broker quantities at the opening date and immediately after each relevant purchase/sale, at full precision.
2. Identify the first date at which the broker record and app history diverge. Do not infer a missing transaction from the final difference alone.
3. Propose an exact correction only after the broker evidence identifies the incorrect record. Historical trades without snapshots are not eligible for the atomic correction workflow.
4. Obtain separate scoped authorization before any database/data change; test the correction and rollback on an isolated synthetic database first.

The precision fix does not close the real-data discrepancy. Security Gate remains HOLD. This review is not a claim of a completed data repair or authenticated mutation QA.
