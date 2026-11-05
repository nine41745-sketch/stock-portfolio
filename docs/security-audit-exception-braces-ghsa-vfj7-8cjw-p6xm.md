# Full Audit Exception: GHSA-vfj7-8cjw-p6xm

- Status: CLOSED (2026-11-05, v1.41.26). The CI exception was removed from `scripts/qa/summarize-npm-audit.mjs`. The text below is the historical record of the exception and is no longer in effect.
- Closure reason: GitHub marked the advisory as withdrawn on 2026-10-23T12:53:02Z (read from the GitHub advisory API on 2026-11-05), and `npm audit --json` run on 2026-11-05 no longer reports `braces`. `braces@3.0.3` is still installed through `tailwindcss`; if an advisory for it is published again, the full audit reports `FINDINGS` and fails CI until it is handled. The scheduled 2026-11-20 review is no longer needed.
- Former status: temporary CI exception for the full dependency audit only; this is not a vulnerability waiver or production risk acceptance.
- Advisory: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), affecting `braces <= 3.0.3`.
- Reason: the advisory is High severity and the GitHub Advisory Database reports no patched version as of the latest check. CI accepts only this exact advisory under the checks in `scripts/qa/summarize-npm-audit.mjs`; Critical findings, another advisory, an unexpected dependency path/version, or any production-only finding still fails.
- Dependency paths observed with `npm ls braces --all --json` on 2026-10-20:
  - `stock-portfolio > tailwindcss@3.4.19 > chokidar@3.6.0 > braces@3.0.3`
  - `stock-portfolio > tailwindcss@3.4.19 > micromatch@4.0.8 > braces@3.0.3`
- Latest advisory check: 2026-10-20; GitHub reports affected versions `<= 3.0.3`, severity High, and no patched versions.
- Next review date: 2026-11-20.
- Close this exception when either a compatible fixed `braces` version is available and adopted through the normal dependency review, or the affected `micromatch`/`chokidar` dependency paths are no longer present. Re-run both full and production-only audits and remove this record and CI exception as part of that review.

The full audit remains reported as `PASS_WITH_EXCEPTION`, keeping the finding visible in the CI summary and uploaded evidence. The production-only command and its required `PASS` gate are unchanged.
