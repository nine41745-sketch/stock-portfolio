# Next.js 16.4.1 security patch — local development assessment

Baseline: `origin/main` at `5d796cc452b79220a47dfc20c4efa526b9bdd785`.
Branch: `fix/nextjs-16.4.1-security`. Assessment date: 2026-10-15.
Application release metadata remains **v1.35.0**. This document does not record a Production release.

## Dependency scope

| Dependency | Baseline | Patched resolution |
| --- | --- | --- |
| next | 16.3.8 | 16.4.1 |
| eslint-config-next | 16.3.8 | 16.4.1 |
| react / react-dom | 19.3.0 | 19.3.1 / 19.3.1 |
| sharp (transitive through next) | 0.35.5 | 0.35.5 |

The npm-generated lockfile also updates the matching `@next/env`, ESLint plugin and platform SWC packages to 16.4.1. All other lockfile package entries are unchanged. No major dependency upgrade, Tailwind 4 conversion, Supabase change, schema change, environment setting change or PR #67 change is included.

Exact manifest/lockfile assertions remain enabled and now require the patched versions, including Sharp 0.35.5. React type packages remain at their existing 19.3.0 resolution. Runtime React and ReactDOM are updated together as part of the related React security release; this does not replace updating Next.js's bundled RSC implementation.

## Official advisories and observed exposure

The vendor's [Next.js 16.4.1 release](https://github.com/vercel/next.js/releases/tag/v16.4.1) lists all three requested fixes. GitHub's global advisory URL/API returned 404 at inspection time; the repository's published security advisories below were available. Registry audit results alone therefore do not establish coverage of these newly published advisories.

| Advisory | Verified baseline facts | Source/build applicability and remaining uncertainty |
| --- | --- | --- |
| [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr), Critical | Next 16.3.8 is in the vendor's affected 16.0.0–16.4.0 range. Exploitation requires Cache Components and a `use cache` function returning multiple typed arrays. | **Not Applicable to inspected authored paths**: repository search found no `use cache`; `next.config.js` does not enable Cache Components; the patched local production build reports `cacheComponents: false`. **Potential / not verified on Production**: the deployed bundle and runtime were not inspected. Upgrade remains appropriate under the vendor recommendation. |
| [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw), Critical, CVE-2026-96889 | The affected Next version is present at baseline. `components/portfolio/ImportPreviewWorkspace.tsx` imports `next/image`; its image uses a local blob URL and `unoptimized`, with JPG/PNG/WebP inputs. `proxy.ts` excludes `_next/image` from the matcher. | **Potential framework surface**, although the inspected UI path bypasses optimization. Both baseline and patched lockfiles resolve Sharp **0.35.5**, meeting the vendor workaround. Local built config has `dangerouslyAllowSVG: false`, zero remote patterns and global `unoptimized: false`; absence of a UI call does not prove the optimizer endpoint is unreachable. Production Sharp/native library/platform and custom request behavior are **not verified**. No exploit request was sent. |
| [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r), High | App Router is used and baseline Next 16.3.8 is affected when at least one Server Action exists. | **Not Applicable to inspected authored paths**: no `use server` directives were found; the patched local build's server-reference manifest contains zero Node and zero Edge Server Action entries. Route Handlers are not automatically Server Actions. Production's action manifest was **not verified**. |

These applicability statements combine source search, configuration, lockfile and local build evidence. They do not claim Production is safe or patched. No Production access or vulnerability probing is part of this work.

Related upstream references: [React 19.3.1 release](https://github.com/react/react/releases/tag/v19.3.1), [RSC transport RCE](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3), and [Server Function DoS](https://github.com/react/react/security/advisories/GHSA-h3gv-c5rc-p453). These explain the related Next.js security release; no independent RSC dependency or unrelated remediation is introduced. The vendor lists patched RSC package version 19.3.1; Next.js bundles its own implementation, so application-level React version alone cannot prove that bundle is patched.

## Validation and evidence boundaries

Node.js 22.23.3 / npm 10.9.9, isolated worktree, committed baseline SQL and synthetic data only:

- `npm ci`: PASS. npm reports the existing seven High findings and an ESLint 9 deprecation warning.
- `npm ls next react react-dom eslint-config-next sharp`: PASS, resolutions match the table.
- `npm run lint`: PASS, zero errors and three existing warnings.
- `npm run typecheck`, `npm run test:critical`, `npm run build`: PASS. Build uses non-secret CI placeholders with outbound networking denied; its artifacts are not deployment artifacts.
- Critical tests include source/SQL assertions, behavioral tests and mocked API tests. Their success is separate from the real local Auth/PIN/browser results.
- Authenticated Chromium QA: **PASS 41/41**, using a new disposable Supabase project (`stock-portfolio-next1641-20261015`) on loopback ports 56321/56322 and app port 3164. Coverage includes real synthetic Auth/PIN rejection/setup/unlock, Dashboard/version badge, Scanner, separate portfolio Watchlists/Collections/Rules, Legacy exclusion from real Scanner mine, 4 OS/app theme pairs, 375/768/1440px and existing Scanner/Fundamentals axe/contrast checks. Provider data and Exchange Rate are mocked; no live provider credentials are used. Final run: zero unexpected console/runtime errors, zero browser/server outbound attempts.
- Two earlier QA attempts failed at harness synchronization/selector assertions: the first submitted an incorrect PIN before the lock navigation/refresh had settled; the second expected the old fixed Dashboard heading name, although the baseline page renders the active portfolio title using CSS-generated content. The final harness waits for navigation to settle, retains the original incorrect-PIN rejection/message assertion, verifies the visible Dashboard heading/version via DOM and adds an Exchange Rate mock. Original runner assertions remain enabled. Failed-attempt logs are retained locally; the first run's four Exchange Rate requests were blocked by the guard and did not reach an external service.
- These theme/accessibility checks do not certify every Dashboard/Quick Notes/placeholder state. Known v1.35.1 UI/autosave changes in PR #67 are not part of this main-based patch. No Production browser session or portfolio data is used.

Local ignored evidence: `.local-artifacts/security-1641/validation/`, `dependency-diff.json`, `build-exposure.json`, and `browser/`.

The QA launcher and runner are ignored local files derived from the committed runner, with isolated ports, the explicit Dashboard check and the harness adjustments above. They are not CI workflow changes. The recorded QA Node process tree and only this disposable Supabase project were stopped after testing; existing projects/volumes were not modified.

## Remaining security / release gate

Production-only audit: **PASS, 0 vulnerabilities**. Full audit: **FAIL, 7 High**, 0 Critical, Moderate or Low. Registry responses were obtained during this work. All seven package entries resolve to the existing `GHSA-vfj7-8cjw-p6xm` advisory: `braces`, `chokidar`, `micromatch`, `fast-glob`, `tailwindcss`, `@next/eslint-plugin-next` and `eslint-config-next`.

The development/build findings are not remediated or accepted here. Earlier release risk acceptance does not authorize this branch or a subsequent release. No audit fix, suppression, weakened assertion or security gate change is included.

Owner review must decide how this separate main-based security patch will be integrated with PR #67, which contains additional hotfix changes absent from this branch. Push/PR, merge, Production deployment and tag/release each require their applicable scoped approval. Local readiness does not authorize any of them.
