# Production Release Status

## Version under preparation — v1.41.25

- Scope: ปรับตัวตรวจ `scripts/qa/summarize-npm-audit.mjs` ให้ข้อยกเว้น minimatch (GHSA-g3hv-75wg-m249) ยอมรับช่วงเวอร์ชันที่ npm audit รายงานอยู่ตอนนี้ (package `7.0.0 - 11.0.0`, advisory `>=7.0.0 <11.0.1`) นอกเหนือจากค่าเดิม `<11.0.1`; เงื่อนไขอื่นไม่เปลี่ยน (moderate เท่านั้น, dev-only ทั้ง chain, หมดอายุ 2026-12-15, Production-only audit ไม่มีข้อยกเว้น). ไม่แตะ workflow, ruleset, SQL, env หรือการตั้งค่า GitHub/Vercel.
- Development/Feature History: `Development History — Feature commit 2026-11-05 01:57:07 +07:00 (ไม่ใช่ Production)`.
- Evidence: on 2026-11-04 the `security-audit` job of Draft PR #146 (head `dacc7558`, documentation only) reported `FULL_AUDIT_STATUS: FINDINGS` with the production-only audit PASS, while main run for `8fd13d52` (2026-11-03) reported `PASS_WITH_EXCEPTION` with the same lockfile. Reproduced locally with the real dependency tree: before the change `summarize-npm-audit.mjs` returned `FINDINGS`; after it returns `PASS_WITH_EXCEPTION`. The cause is the external advisory data spelling, not repository code. The 2026-12-15 expiry recorded for v1.41.17 is unchanged; the exception had already stopped matching before that date.
- Release state: merged to `main` as `a4cb11a8306747931623e5a6cc988c44be03a8ec` (PR #147, squash, head `8a23121d93c87cc24dc2e1d9da2cad1e3af2a582`) at `2026-11-04T19:14:40Z` (`2026-11-05T02:14:40+07:00`, from the GitHub merge record; this is a merge time, not a Production time). It has NOT been deployed or promoted: Production remained `dpl_g13ug98zKMDF4Sz6LCR5yDnJwv4m` (v1.41.24) when checked after the merge. Security Gate and Production Release Gate remain HOLD for v1.41.25.
- Review: this changes a security gate checker. The review record is the PR #147 comment `issuecomment-6639705882` (verdict APPROVE at that head SHA) from a separate Claude cloud session, which is not a different person, GitHub account or model family; whether it satisfies the independent-review rule is the owner's decision. A Low finding (package and advisory ranges are checked by two separate sets, so a cross pairing of approved strings is accepted) was left unfixed.

## Version under preparation — v1.41.24

- Scope: คุณภาพข้อความ AI ของ Stock Check: ตัวตรวจคำกล่าวอ้างที่ขัดกับตัวเลขที่คำนวณแล้ว, เพิ่มงบโทเค็นของโมเดลหลัก, ลองโมเดลสำรองเมื่อคำตอบใช้ไม่ได้, ปรับ prompt เรื่องช่วงเวลา earnings. ไม่แตะ `secValuationGuard`, SQL หรือตัวแปร Vercel.
- Development/Feature History: `Development History — Feature commit 2026-11-04 09:00:00 +07:00 (ไม่ใช่ Production)`.
- Release state: Local Diff; Security Gate and Production Release Gate remain HOLD for v1.41.24. No push, merge, deployment or Production change is authorized by this task. Behavior against the live Groq API is NOT VERIFIED; the token-budget cause of empty/truncated replies is an unconfirmed hypothesis.
- Production: deployed and promoted on 2026-11-03 (see "Current Production status — v1.41.24" below). The gate states above were written before deployment and are not updated here; the gate decision is recorded in that section.

## Version under preparation — v1.41.23

- Scope: ระยะ B ของแผนปรับหน้าพื้นฐาน/มูลค่า: ปฏิทินประกาศผลที่ว่างอธิบายว่า "ไม่พบนัดใน 60 วันข้างหน้า" แยกจากข้อมูลขาดหรือผู้ให้บริการขัดข้อง. ไม่แตะ `secValuationGuard`, P/E Scenario, SQL หรือตัวแปร Vercel.
- Development/Feature History: `Development History — Feature commit 2026-11-03 23:30:00 +07:00 (ไม่ใช่ Production)`.
- Release state: Local Diff; Security Gate and Production Release Gate remain HOLD for v1.41.23. No merge, deployment or Production change is authorized by this task.
- Production: no separate Production deployment. It shipped inside the v1.41.24 deployment (source SHA `8fd13d5230131e51a0c41e0934cf3d084e05852b`); see "Current Production status — v1.41.24" below.

## Version under preparation — v1.41.22

- Scope: ระยะ A ของแผนปรับหน้าพื้นฐาน/มูลค่า: แสดงชนิด P/E บนหน้าพอร์ต และเลิกตัดข้อมูลเพิ่มเติมของ Finnhub ที่ 60 รายการ (เพดานใหม่ 200) พร้อมจัดกลุ่ม ROE/ROI กระแสเงินสด เงินปันผล และสภาพคล่อง. ไม่แตะ P/E Scenario, SQL หรือตัวแปร Vercel.
- Development/Feature History: `Development History — Feature commit 2026-11-03 16:01:00 +07:00 (ไม่ใช่ Production)`.
- Release state: Local Diff; Security Gate and Production Release Gate remain HOLD for v1.41.22. No merge, deployment or Production change is authorized by this task.
- Production: deployed and promoted on 2026-11-03 and later superseded by v1.41.24; see "Production deployments after v1.41.10" below.

## Version under preparation — v1.41.21

- Scope: แสดงคำแนะนำตั้งแจ้งเตือนเมื่อแผนรอย่ออยู่ห่างเกิน 5% และแยกคะแนนแนวโน้มออกจากทิศทางราคา (PR #138, เรียงเลขใหม่จาก v1.41.16 หลัง main ไปถึง v1.41.20).
- Development/Feature History: `Development History — Feature commit 2026-10-31 12:09:31 +07:00 (ไม่ใช่ Production)`.
- Release state: Local Diff on a Draft PR; Security Gate and Production Release Gate remain HOLD for v1.41.21. No merge, deployment or Production change is authorized by this task.

## Version under preparation — v1.41.20

- Scope: Stock Check อธิบายว่าค่า P/E มาจาก Finnhub และชนิดอาจเป็นรายปีปรับค่าหรือ TTM.
- Development/Feature History: `2026-11-03T06:06:34Z` (`2026-11-03 13:06:34 +07:00`), from local Git commit `c377b580fc4f6137b73284eb0256a4a9783d4ccc`.
- Release state: Local Diff; Security Gate and Production Release Gate remain HOLD for v1.41.20. No merge, deployment or Production change is authorized by this task.

## Version under preparation — v1.41.19

- Scope: แก้คุณภาพข้อมูลสแกน (ราคาเก่า, R:R, สัญญาณขัดกัน, volume ระหว่างตลาดเปิด, สัญลักษณ์ BRK.B, คะแนน/วันประกาศงบของ Discovery, ป้ายเวลาราคา, prompt ของ AI) จากผลทดสอบแบบอ่านอย่างเดียวบน Production.
- Development/Feature History: `2026-11-03T03:18:27Z` (`2026-11-03 10:18:27 +07:00`), from local Git commit `df5c478de10f5d736c3827699a0508bd68b03e8a`.
- Release state: Local Diff; Security Gate and Production Release Gate remain HOLD for v1.41.19. No merge, deployment or Production change is authorized by this task. Behavior on a live Preview/Production deployment is NOT VERIFIED; the cache-staleness cause of old prices is an unconfirmed hypothesis.

## Version under preparation — v1.41.18

- Scope: ให้ Preview ของทุก branch ใช้ฐานข้อมูล Production ได้เมื่อเจ้าของตั้ง `NEXT_PUBLIC_SUPABASE_PREVIEW_PRODUCTION_ACCESS_BRANCH` เป็น `*` เองบน Vercel (การตัดสินใจของเจ้าของ 2026-11-03) ถ้าไม่ตั้งตัวแปรนี้ guard ยังปิด Preview เหมือนเดิม. Cron ยังถูกบล็อกบน Preview ทุกตัว.
- Development/Feature History: `2026-11-03T03:46:28Z` (`2026-11-03 10:46:28 +07:00`), from local Git commit `d779baf6891d3c51e5db912df6cef9ac6413ffa6`.
- Release state: Local Diff; Security Gate and Production Release Gate remain HOLD for v1.41.18. No merge, deployment or Production change is authorized by this task. The owner set the Vercel Preview variables on 2026-11-03; Preview behavior on Vercel remains NOT VERIFIED until a Preview built after this change is inspected.

## Version under preparation — v1.41.17

- Scope: ปรับ security-audit ให้ยกเว้น GHSA-g3hv-75wg-m249 ได้เฉพาะกรณี dev-only ทั้ง dependency chain พร้อมวันหมดอายุ 2026-12-15; Production-only audit ยังไม่มีข้อยกเว้น.
- Development/Feature History: `2026-10-31T05:48:47Z` (`2026-10-31 12:48:47 +07:00`), from local Git commit; no Production time is claimed.
- Release state: local branch only; no push or deployment. Security Gate และ Production Release Gate คง HOLD; งานนี้เปลี่ยนเฉพาะ CI/reporting และไฟล์เวอร์ชัน/เอกสาร ไม่มีการเปลี่ยน runtime.


## Version under preparation — v1.41.15

- Scope: ทำให้หน้าโอกาสวันนี้อธิบายคะแนนแนวโน้มอย่างเป็นกลาง แสดงคำเตือน gap risk และแยกตัวนับตามป้ายที่เห็นบนการ์ด.
- Development/Feature History: `2026-10-30T11:08:41Z` (`2026-10-30 18:08:41 +07:00`), from Git commit `415b1b4097e39c0de558bac362ccc0d1d7e3cded`.
- Release state: Local Diff; Security Gate and Production Release Gate remain HOLD for v1.41.15. No merge or deployment is authorized by this task.

## Version under preparation — v1.41.14

- Scope: แสดงขอบบนและราคากลางของแผนรอย่อ พร้อมเวลาและข้อจำกัดของ R:R.
- Development/Feature History: `2026-10-30T06:45:11Z` (`2026-10-30 13:45:11 +07:00`), from local Git commit `d3158e507251d9aed0c55d5914fd72506fb77018`.
- Release state: Local Diff; Security Gate and Production Release Gate remain HOLD for v1.41.14.

## Version under preparation — v1.41.13

- Scope: ปรับการ์ดรอ Breakout ให้แสดงจุดทะลุและเงื่อนไขยืนยัน โดยซ่อน Entry/Stop/Target/R:R ซึ่งยังไม่ใช่แผนซื้อ.
- Development/Feature History: `2026-10-30T05:40:32Z` (`2026-10-30T12:40:32+07:00`), from local Git commit `18e7256c6f153899c2b06bc58409ffd8172fdfa3`.
- Release state: local branch only; no push, deployment or promotion. Security Gate and Production Release Gate remain HOLD for v1.41.13.
- Current Production status remains the v1.41.10 deployment recorded below.

## Version under preparation — v1.41.11

- Scope: ปรับป้ายเวลาเดิมใน Changelog v1.30.0–v1.34.0 ให้ระบุว่าเก็บค่าตามบันทึกเดิมและยังไม่มีหลักฐานยืนยันว่าเป็นเวลา Production.
- Development timestamp: รอ Git/GitHub commit event ของการเปลี่ยนแปลงนี้; ยังไม่กำหนดเวลาใน Local Diff.
- Release state: ยังไม่มี Commit/Push หรือ Production Deployment; Security Gate และ Production Release Gate ของ v1.41.11 คง HOLD.
- Current Production remains v1.41.10 at SHA `2eb275f27f8b724548ba7421ad26af1254e33325` / Deployment `dpl_9HDmqhAr9bLeeKdYTRePtqLmNCGg`.


## Current Production status — v1.41.24

Recorded after deployment, on 2026-11-04 (Asia/Bangkok). Facts below come from the Vercel API/Activity events, GitHub check runs, or read-only requests made in an owner-unlocked session; anything not checked is listed under "Not verified".

- Production deployment: [`dpl_g13ug98zKMDF4Sz6LCR5yDnJwv4m`](https://vercel.com/nine41745/stock-portfolio/g13ug98zKMDF4Sz6LCR5yDnJwv4m), URL `stock-portfolio-3tgr93ozn-nine41745.vercel.app`, READY, target production. After promotion the Vercel project API reports it as the production target.
- Source: `main` at `8fd13d5230131e51a0c41e0934cf3d084e05852b` (squash merge of PR #145); package version `1.41.24`. It also contains v1.41.23 (PR #144), which had no Production deployment of its own.
- Provenance limit: the deployment was created with `vercel deploy --prod --yes --no-wait` from a clean git worktree detached at this exact SHA (`git rev-parse HEAD` was checked before the command). It was NOT created with `--meta sourceGitSha=...`, so Vercel deployment metadata carries no source SHA for it. The SHA above is therefore supported by the local check and the merge record, not by Vercel metadata.
- Deployment time: Vercel Activity event `uev_pSi7GseWZZfLfQdzQBjLLG6Y` — `2026-11-03T18:23:37.730Z` (`2026-11-04T01:23:37.730+07:00`), "requested by claude-code_2-1-309_agent", via Vercel CLI. It was created Staged (the project has `autoAssignCustomDomains` off).
- Production (promotion) time: Vercel Activity event `uev_idpeN23IYDTj2Wipui1H0qUT` (`manual-deployment-promotion-created`) — `2026-11-03T18:26:23.882Z` (`2026-11-04T01:26:23.882+07:00`), via Vercel CLI. Alias event `uev_GcjkxJJNDdNGtJtk0XUuMYPz` — `2026-11-03T18:26:25.650Z` (`2026-11-04T01:26:25.650+07:00`), "assigned 2 aliases". The deployment alias list shows `stock-portfolio-nine41745.vercel.app` and `stock-portfolio-seven-inky.vercel.app`.
- Owner approvals (given in chat, one per action): deploy of the exact SHA to a Staged Production deployment, then promotion of the exact deployment ID. Merge of PR #145 at head `15c2d57ac4f973e137e26b3d9018fc0ef18152fe` was approved separately.
- CI: GitHub check runs `verify` and `security-audit` completed with success on `8fd13d52`. CI was not rerun for this record.
- Rollback target: [`dpl_3G5cwXFrbjrRcwNCFdkETnX7L4ep`](https://vercel.com/nine41745/stock-portfolio/3G5cwXFrbjrRcwNCFdkETnX7L4ep) (v1.41.22, promoted `2026-11-03T16:03:03.606Z`). Rollback was not executed and is not authorized by this record.
- Post-promotion read-only checks (owner-unlocked session; no trade, edit or save action): Dashboard displayed v1.41.24; the P/E kind label ("รายปี") still showed in the portfolio; the Fundamentals page showed "ไม่พบนัดประกาศผลใน 60 วันข้างหน้า" for AAPL and NOW; Finnhub additional metrics returned 113 (AAPL) and 101 (NOW) items; SEC status was available for both; Stock Check prices for AAPL, MSFT and NVDA came from Finnhub with age 0 minutes; the Stock Check AI endpoint returned HTTP 200 for AAPL and NVDA with no fallback summary and 0 removed claims (NVDA used the smaller fallback model after a Groq 429).
- Runtime logs: no error-level entries for this deployment in the 24 hours checked other than three Groq HTTP 429 (rate limit) responses on `openai/gpt-oss-120b`, caused by test traffic.
- Cron evidence, read-only, checked 2026-11-04T02:24Z (09:24 +07:00). No Cron endpoint was called and Run was not pressed:
  - Registry: the Vercel project API reports `crons.deploymentId` = `dpl_g13ug98zKMDF4Sz6LCR5yDnJwv4m`, enabled (`disabledAt` null), updated `2026-11-03T18:26:24Z`, with three definitions matching `vercel.json`: `/api/cron/daily-analyze` `15 1 * * 2-6`, and `/api/cron/premarket-analyze` `45 12 * * 1-5` and `45 13 * * 1-5` (UTC).
  - Invocation: one runtime log record for `GET /api/cron/daily-analyze` on this deployment at `2026-11-04T02:07:50.298Z` (production, region iad1, level info; the message is a Yahoo library survey notice). Vercel Hobby retains about one hour of runtime logs, so earlier logs could not be read, the HTTP status was not visible, and only this one record was returned.
  - Errors: zero error-level and zero warning-level log records for this deployment between 01:24Z and 02:24Z.
  - Result: through the owner-logged-in session, `GET /api/daily-analyses/today` (select-only route; its source was read first) returned 8 analyses (ORCL, NVO, WDC, RKLB, SOFI, NOW, VRT, EOSE), all `analysedAt` `2026-11-04T02:07:51.456Z`, mode `DAILY_POST_CLOSE`, model `openai/gpt-oss-120b`, no stale symbols.
  - Text check against the stored technical numbers: trend, RSI and earnings-day statements matched. Two problems were observed in the portfolio analysis text, which does not use the Stock Check claim guard: WDC summary line 1 says there is no new scale-in trigger and the action is HOLD while line 2 says it is suitable for adding a position; EOSE text says price is at support but price $1.87 is 17.6% above support $1.59. NVO earnings are on the same day (`daysUntil` 0) and are not mentioned. These are observations only; no change was made.
  - Unconfirmed observation: the stored technicals for all 8 symbols use a last daily bar dated 2026-11-02 while the price comes from Finnhub for 2026-11-03; a later read of the Yahoo daily series for ORCL does include the 2026-11-03 bar. The cause (provider timing, cache or code) was not investigated and it was not compared with earlier days.
  - Pre-market run, checked 2026-11-04T18:34Z (2026-11-05 01:34 +07:00) through the same select-only route: 6 of the 8 symbols (ORCL, NVO, WDC, RKLB, NOW, VRT) carry mode `PREMARKET_TRIGGER` with `analysedAt` `2026-11-04T14:16:53.360Z`, model `openai/gpt-oss-120b`; SOFI and EOSE still carry the `DAILY_POST_CLOSE` result from 02:07:51Z. A single save time for the batch means one pre-market execution saved results. That the other schedule candidate was skipped by the `08:45-09:44 ET` window rule is an inference from `lib/market-status.ts` and `app/api/cron/premarket-analyze/route.ts`, not an observation: the runtime logs for that time were outside the Hobby retention window.
  - The pre-market route reuses `baseline.technical` from the stored daily analysis (route line 205), so its `lastBarAt` (`2026-11-02`), RSI and EMA50 repeat the daily values. It therefore gives no new evidence about the one-session lag of the daily technicals.
  - Pre-market text spot check against stored numbers: WDC "gap down 4.1%" (price 332.94 vs previous close 347.35) and VRT "gap down 7.5%" (218.2 vs 235.97) match. RKLB says earnings are "not near" while the stored earnings date is 2026-11-09 (5 days; the daily text said "near"). NVO reports earnings on 2026-11-04 and its pre-market text does not mention it.
- Preview evidence for the same code (PR #145, head `15c2d57a`): eight Stock Check AI calls returned HTTP 200, none used the engine-summary fallback and none had a claim removed; 3 of 8 used the smaller model after Groq 429.
- Security Gate and Production Release Gate: NOT recorded as lifted for v1.41.24. The owner approved the exact deployment and the exact promotion, but did not state that the gates are lifted, and the Cron checks below were not performed. Status: HOLD pending an explicit owner decision.
- Not verified: which `premarket-analyze` schedule candidate executed (no runtime log in the retention window; see inference above); whether the `daily-analyze` run finished with a successful HTTP status (not visible in the retained logs); Discovery page; mobile and light-theme layout, including the longer Earnings Calendar text; whether the AI claim guard removes a contradicting sentence from a live model reply (it is covered by synthetic tests only); how often Groq 429 occurs under normal use; authenticated staged QA beyond the read-only checks above.
- Deviations from the Promotion procedure in `AGENTS.md`: the deployment was not created with `--skip-domain --meta sourceGitSha=...`; the promotion approval named the deployment ID and source SHA but not the exact Production domains; Cron registry/invocation evidence was not inspected at promotion time; and this record was written after the promotion, not at the same time.
- Remaining work (none of it authorized by this record): the next `daily-analyze` run (schedule 2026-11-05 01:15Z) to see whether its last daily bar is the latest completed session; Discovery and mobile/light-theme checks; the CI audit exception for `minimatch` (`GHSA-g3hv-75wg-m249`, dev-only) is coded to expire 2026-12-15 in `scripts/qa/summarize-npm-audit.mjs`, after which the full audit is expected to report findings; the exception had already stopped matching on 2026-11-04 because the external advisory data changed its range spelling, and v1.41.25 (PR #147) re-accepts the two exact spellings now reported, so the root fix (an ESLint toolchain that uses minimatch 11.0.1 or later) is still open; the `braces` exception record lists 2026-11-20 as its next review date; Git tags exist up to `v1.41.9` and the latest GitHub Release is `v1.34.1` — creating tags/releases needs owner approval; 7 open Dependabot PRs and 8 older Draft PRs have not been reviewed.

## Production deployments after v1.41.10

Recorded retroactively from the Vercel deployment list and Activity events on 2026-11-04. Gate approvals for these releases were not found in this file; no gate state is asserted here.

- v1.41.14 — `dpl_4PX68LdE4dWuBxrNHcgdLELeHKu1`, Vercel metadata SHA `d13f9b52` (package version at that commit: `1.41.14`). Promoted `2026-10-30T07:42:00.055Z` (`2026-10-30T14:42:00.055+07:00`) per event `uev_wW58qIHpcRTCEjbv9T4fHsbW`, via ChatGPT.
- v1.41.15 — `dpl_67gJnAVZb8U41WN3JQxz2zNNqbuy`, Vercel metadata SHA `7612fc3a` (package version at that commit: `1.41.15`). Promoted `2026-10-30T12:07:00.067Z` (`2026-10-30T19:07:00.067+07:00`) per event `uev_aMzDwGGUyOesB8mupc6yyQ3l`, via ChatGPT. Production ran this version until v1.41.22.
- v1.41.22 — `dpl_3G5cwXFrbjrRcwNCFdkETnX7L4ep`, source SHA `9f3bcd56a09d5ffb5163c8d39e5dbe0e0361addf` (from the detached worktree used for the deploy; Vercel metadata has no SHA, same provenance limit as above). Deployed `2026-11-03T15:53:41.746Z` (event `uev_9zmLtPXH0frdhjgpbQx28OeF`), promoted `2026-11-03T16:03:03.606Z` (`2026-11-03T23:03:03.606+07:00`, event `uev_2cDJv22SBz2mRCQvfVjFaQih`), via Vercel CLI. Superseded by v1.41.24 at `2026-11-03T18:26:23.882Z`.
- v1.41.11 to v1.41.13, v1.41.16 to v1.41.21 and v1.41.23: no separate Production deployment found in the Vercel production deployment list; they reached Production only inside the deployments above.

## Previous Production status — v1.41.9

- Previous Production deployment: [`dpl_8XPNygW7YbPB1sd8UitoG9oyiWjb`](https://vercel.com/nine41745/stock-portfolio/8XPNygW7YbPB1sd8UitoG9oyiWjb), source SHA `b13d977e1304ad4075398edb30b795f802f51a82` (previously verified). Before the v1.41.10 promotion, both Production domains mapped to this deployment.
- The earlier v1.41.8 gate approval remains scoped only to that release; current v1.41.10 gate decisions are recorded below.

## Previous Production status — v1.41.10

- Production source SHA (main at the time of promotion): `2eb275f27f8b724548ba7421ad26af1254e33325`; package version `1.41.10`. The deployment command ran in a clean checkout at this exact Git SHA. The build log also contained `f4c2867`, which does not match this source SHA and must not be treated as its short commit.
- Production deployment: [`dpl_9HDmqhAr9bLeeKdYTRePtqLmNCGg`](https://vercel.com/nine41745/stock-portfolio/9HDmqhAr9bLeeKdYTRePtqLmNCGg), URL [stock-portfolio-2efgnsaba-nine41745.vercel.app](https://stock-portfolio-2efgnsaba-nine41745.vercel.app), READY, source SHA `2eb275f27f8b724548ba7421ad26af1254e33325`. Created once with `vercel deploy --prod --skip-domain --meta sourceGitSha=2eb275f27f8b724548ba7421ad26af1254e33325`.
- Vercel Activity Event `uev_rRwuvBiBYM7PasiOa0zKKGsh` records assignment of two aliases and carries both `sourceGitSha` and `gitCommitSha` equal to the exact SHA. Direct deployment lookup returns `meta: {}`; the Activity Event is the full-SHA provenance evidence. The alias assignment/Production time is `2026-10-29T16:39:26.094Z` (`2026-10-29T23:39:26.094+07:00`).
- Build: PASS. Vercel reported READY and `Build Completed in /vercel/output [59s]`; install completed, the configured critical regression suite passed, and the project used Node.js `22.x` for build/runtime. Exact-main CI run 40909626381 had already passed; CI was not rerun for this staging task.
- The Vercel alias assignment event records 2 aliases. Post-promotion direct lookups and the deployment alias list confirm both `stock-portfolio-nine41745.vercel.app` and `stock-portfolio-seven-inky.vercel.app` map to this deployment. The deployment summary's `alias: []` field conflicts with those results; direct alias lookups plus the alias list and assignment event provide the mapping evidence. The previous Production deployment `dpl_8XPNygW7YbPB1sd8UitoG9oyiWjb` is the recorded rollback target; no rollback was performed.
- Cron/Production DB isolation and the `unrs-resolver` fallback behavior remain UNVERIFIED. Staged functional QA was not performed. Cron schedules were left unchanged and no Cron was invoked.
- Production authenticated read-only UI checks used an owner-unlocked browser session: Dashboard displayed v1.41.10; Transactions rendered its ledger table; Performance rendered its portfolio performance section; and `/imports` redirected to `/dashboard`. No trade, edit or save action was used. The browser reported zero captured console errors and warnings in the earlier four-route check. These checks do not validate portfolio amounts, trading, every API response, or all runtime errors. The application accessed Production data through the approved pages.
- Security Gate: APPROVED. Production Release Gate: APPROVED. The owner explicitly approved lifting both gates for v1.41.10 source SHA `2eb275f27f8b724548ba7421ad26af1254e33325` and deployment `dpl_9HDmqhAr9bLeeKdYTRePtqLmNCGg`, accepting the stated limitations; this approval does not extend to other SHAs or deployments. Authenticated Staged QA, Cron/Production DB isolation and `unrs-resolver` fallback behavior remain unverified. The owner-provided Instant Rollback dialog showed a Previous deployment URL prefix matching `stock-portfolio-q6742t450-nine41745.vercel.app`, which Vercel deployment details associate with `dpl_8XPNygW7YbPB1sd8UitoG9oyiWjb` (READY); the dialog did not show the full ID and no rollback was performed. No Cron endpoint was called.

## Previous Production status — v1.41.8, 2026-10-29 Asia/Bangkok

- Production deployment [`dpl_8wfgnXeLPhLbpH8cEMJPHNnzkyCv`](https://vercel.com/nine41745/stock-portfolio/8wfgnXeLPhLbpH8cEMJPHNnzkyCv) is READY. Vercel deployment metadata reports source SHA `f4c286700706086a3e2fb722341b1f9f14aed09d`; the clean source checkout and metadata support provenance, but do not prove every deployed byte independently.
- Vercel alias lookups after the owner's authorized promotion mapped both `stock-portfolio-nine41745.vercel.app` and `stock-portfolio-seven-inky.vercel.app` to that deployment. The promotion alias list reported both completed. The Connector deployment summary returned `alias: []`; direct alias lookups supply the mapping evidence.
- The owner explicitly approved lifting both Security Gate and Production Release Gate for v1.41.8 only at the SHA and deployment above, accepting the limitations below. This approval does not extend to another SHA or deployment.
- Existing [main CI run 40829671348](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40829671348) completed successfully on the exact SHA; `verify` and `security-audit` passed. No CI or audit was rerun for this documentation update.
- Production read-only UI checks used an owner-unlocked session. Dashboard displayed v1.41.8, Transactions and Performance rendered, and `/imports` redirected to Dashboard. Existing Request Logs showed 200 for the checked pages and 307 for `/imports`; the observed browser console contained no errors. Login and PIN entry were not retested. Request log output was paginated and runtime log searches were bounded, so these observations do not establish the absence of all errors.
- The Instant Rollback dialog showed a Previous deployment with URL and abbreviated SHA matching `dpl_4uZ8YYoadSfu1ha1KUPbgPtYgR2c`, SHA `e28e161b805cf9b307c43730a66b66df31809b82`, as confirmed by Vercel deployment details. The dialog did not display the full deployment ID; rollback was not executed.
- Authenticated Staged QA and Cron/Production DB isolation remain unverified. The Staged root produced `identity_mismatch`, consistent with its not being active Production at that time; this does not establish the cause of the earlier Production 503 or prove that it cannot recur. Live Cron execution was not tested during this review.
- Real trade execution and portfolio-number accuracy remain NOT TESTED; the Ledger/Holdings discrepancy remains unresolved pending broker evidence. No real transaction or data correction was performed as part of this documentation update.
- No Staged deployment awaiting promotion has been identified in this documentation task; other deployments were not exhaustively reviewed. This record does not authorize new deployment, promotion, rollback, alias/domain or environment changes, or Production database changes.

## Historical Production and Staged status — verified 2026-10-28

This historical snapshot describes the state at the time of that review and is superseded by the v1.41.8 status above.

- Both `stock-portfolio-nine41745.vercel.app` and `stock-portfolio-seven-inky.vercel.app` resolve through Vercel alias lookup to Production deployment `dpl_9Y4DPaykEAgAF63b9XtDcyHSp9YX` (READY). The deployment is available at `stock-portfolio-5a1p4go53-nine41745.vercel.app`.
- The raw Vercel deployment API and Activity Event `uev_0pnvxsVqJNHNdgcNzrTawphw` report `sourceGitSha` and `gitCommitSha` as `f92566fa9143a15e43937921a0d12cb0b8ee4871`. These metadata labels and events do not prove every uploaded file byte-for-byte. The Vercel Connector's deployment summary returned `meta: {}` and `alias: []`; direct alias lookup and the deployment alias list identify the two domains above.
- Vercel Activity Event `uev_9Vx7OqO1Y1bWfNHj1OBg9bAC` records the Production promotion at `2026-10-27T05:40:38.715Z` (`2026-10-27T12:40:38.715+07:00`). Alias lookup records the secondary domain updated at `2026-10-27T05:40:40.389Z` (`2026-10-27T12:40:40.389+07:00`) and the primary domain at `2026-10-27T06:08:39.950Z` (`2026-10-27T13:08:39.950+07:00`).
- Staged deployment `dpl_4SpT689aBiTa4XCy5pkVizFhLjsb` is READY at `https://stock-portfolio-3nf9irelw-nine41745.vercel.app`, with `sourceGitSha` and `githubCommitSha` `438e6e286dfcc47a3327e3dbe4745e489df955de` in the raw Vercel API. It is a Production-targeted deployment created with `--skip-domain`; its deployment alias list is empty and it has not been promoted.
- The Staged URL returned `Backend isolation is not configured`. The guard blocks access before Supabase authentication when it cannot establish the required Production identity. An identity mismatch is consistent with the observed configuration, but the exact failing condition is not verified. Staged authenticated functional QA was not performed; Cron registration/invocation and runtime database isolation on this Staged deployment remain unverified.
- Security Gate: HOLD. Production Release Gate: HOLD for the Staged SHA and deployment. Existing approval for an earlier release does not extend to this Staged deployment; READY and CI success do not release either gate.
- Before considering Promotion, resolve the Staged guard and Cron/DB isolation limitations, verify the intended Production domains and current rollback target, and obtain the owner's specific approval for the deployment and domains. Current Production `dpl_9Y4DPaykEAgAF63b9XtDcyHSp9YX` is READY and Vercel's deployment list reported `isRollbackCandidate: true` at the time of review; its eligibility after a future Promotion and actual rollback behavior have not been tested.
- The older documented rollback target `dpl_7WxvLDtm21ZrVnveckfCTj6L36nQ` remains READY, but the deployment list reported `isRollbackCandidate: false` at the time of review. Do not infer that it is available for a future rollback without rechecking.

## Historical primary-alias rollout — 2026-10-27 Asia/Bangkok

This post-alias state supersedes the pre-alias staging and historical snapshots below.

- The owner explicitly authorized switching only `stock-portfolio-nine41745.vercel.app` to `dpl_G2Xy6kuSKhuP1ct53HGAWKxhKZ42`, SHA `757853b7f9d8ea43cb85c6a45a32f29ca5cd3427`, with read-only smoke tests and rollback to `dpl_7WxvLDtm21ZrVnveckfCTj6L36nQ` if serious failure occurs. Gate release is conditional on smoke success.
- The alias switch completed. Both the Vercel alias lookup/deployment-alias list and the live primary-domain identity endpoint identify the approved new deployment. Source metadata reports the exact SHA `757853b7f9d8ea43cb85c6a45a32f29ca5cd3427`; the authenticated UI visibly shows version `v1.40.2`.
- This was an alias-only operation. No project-wide Promote, new Build/Deployment, domain configuration, Environment/Secrets change, direct DB operation or data write was performed. The deployment-history query since the alias action returned no new deployments.
- `stock-portfolio-seven-inky.vercel.app` remains on `dpl_AH7JDQFJJUezYJ7A54c5jnWujv7Q`; the Cron registry remains on `stock-portfolio-b3mcqqpau-nine41745.vercel.app`. No Cron endpoint was invoked.
- Authenticated read-only smoke completed after the owner unlocked PIN: protected Dashboard, Transactions and Performance rendered without a Login/PIN prompt; `/imports` resolved to `/dashboard`; and the UI visibly showed `v1.40.2`. No BUY/SELL, Save/Edit/Delete/Import/Execute, provider refresh or analysis action was triggered. Browser Console recorded 0 errors and 0 warnings. A Vercel grouped runtime-error query for these routes over the last 30 minutes returned no error clusters; this bounded query is not a guarantee about all runtime activity.
- Login/PIN access: PASS for this smoke session, based on the owner unlocking PIN and the session subsequently loading protected application routes. Codex did not request, copy, inspect or enter any password/PIN/token. Evidence records only routes and UI-state booleans, without financial values.
- Security Gate: APPROVED — HOLD lifted by the owner's conditional approval after all six authenticated read-only smoke checks passed, scoped only to v1.40.2 SHA `757853b7f9d8ea43cb85c6a45a32f29ca5cd3427` and Deployment `dpl_G2Xy6kuSKhuP1ct53HGAWKxhKZ42`. Production Release Gate: APPROVED — HOLD lifted for the same exact release only. This does not mean BUY/SELL, portfolio-number correctness, live Cron invocation or every possible runtime path was tested.
- Rollback target `dpl_7WxvLDtm21ZrVnveckfCTj6L36nQ` remains available; rollback was not needed because all six approved smoke checks passed and no serious issue was observed.
- Remaining operational work for this scoped release: none. The current-state documentation records the release status. Real trade execution and portfolio-number correctness remain untested, and the unchanged Cron registry/invocation was not tested; neither was exercised during this read-only smoke. The separately approved rollback plan remains primary-alias-only if a serious issue is later identified.
- Existing CI/Audit/Build evidence was reused; no CI, Audit or Build was rerun in this alias task. Real transactions, portfolio-number correctness and live Cron execution remain untested.

Production Release Status

## Pre-alias staging snapshot — 2026-10-27 Asia/Bangkok

This section supersedes the current-state claims in the retained historical snapshot below. No Production release was performed in this staging task.

### Production and domain mapping

- `stock-portfolio-nine41745.vercel.app` still maps to `dpl_7WxvLDtm21ZrVnveckfCTj6L36nQ` (`stock-portfolio-bmekuwduu-nine41745.vercel.app`), verified after staging through the Vercel alias API. Source SHA `9f7a985fae51169f18cb8ea6113e74bf1a3dd8b2` comes from previously accepted release evidence; the current Connector deployment response has `meta: {}` and does not independently re-prove that SHA.
- The project's listed Production domain is `stock-portfolio-seven-inky.vercel.app`, which still maps to `dpl_AH7JDQFJJUezYJ7A54c5jnWujv7Q`. No domain or alias was changed. Project-level Promote can affect this separate Production domain, so the next live-routing authorization must name its intended domain scope explicitly.

### Staged deployment awaiting a release decision

- Source/main SHA: `757853b7f9d8ea43cb85c6a45a32f29ca5cd3427`; package version: `1.40.2`; `git.deploymentEnabled.main` remains `false`.
- Staged ID: `dpl_G2Xy6kuSKhuP1ct53HGAWKxhKZ42`.
- URL: https://stock-portfolio-cw7rttr7t-nine41745.vercel.app
- Target: `production`; source: CLI; status: `READY`; created 2026-10-27 01:35:01 ICT.
- Created exactly once with `vercel deploy --prod --skip-domain`; deployment command exit code `0`. No Promote, alias assignment or rebuild was performed afterward.
- Direct CLI GET confirms `meta.sourceGitSha`, `meta.gitCommitSha` and `meta.githubCommitSha` all equal the full source SHA above. The metadata-filter command returned this deployment. Metadata is supported by a clean exact checkout and a dry-upload manifest: 389 uploaded files, all tracked, no hash mismatches or environment files; only tracked `.env.local.example` was excluded.
- The deployment Node version setting is `22.x`. Build completed successfully; configured regression tests ran as part of the Vercel build. [Exact-main CI run 40300522389](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40300522389) has successful `verify` and `security-audit` check runs. Existing CI was inspected, not rerun.
- Direct deployment GET reports `alias: []`; the deployment-alias list is empty. The primary Production alias remains on its prior deployment. An intermediate Connector response during BUILDING listed the primary alias; the later direct API and alias-mapping reads are the final routing evidence.

### Cron and runtime limitations

- The post-stage Cron registry is still enabled with three configured schedules. Its host remains `stock-portfolio-b3mcqqpau-nine41745.vercel.app` (the previously identified `dpl_9RmeQ3tK7q9bPdWyQwm22cYGsM1n`), not the new staged host. The CLI also retains its local/deployed premarket-schedule mismatch notice; no schedule was edited.
- Source review confirms that both Cron handlers perform the active-Production guard check before service-client/database operations. Existing exact-main CI supplies synthetic guard/regression evidence.
- Safe Browser probes through existing Vercel SSO rendered the exact staged deployment identity and the expected root error `Backend isolation is not configured`. These observations confirm the staged root denies application access; HTTP status and server-side DB/network activity were not independently captured. No app Login/PIN, authenticated portfolio page, Cron endpoint, direct Production database tool or provider action was used. Full live Cron/DB runtime isolation and authenticated Staged QA remain NOT VERIFIED. Empty grouped runtime logs are not proof of absent access.
- The new staged deployment is protected by Vercel Authentication. No bypass/share link was created.

### Gates and remaining work

- Security Gate: HOLD for the new SHA/deployment. Production Release Gate: HOLD for the new SHA/deployment. Earlier owner approvals remain limited to their earlier exact release and do not transfer to this deployment.
- Before live release, the owner must explicitly approve the deployment/SHA and intended existing alias/domain scope, and decide how to validate or accept the stated runtime-QA limitations. Do not infer that project-level Promote changes only the manually assigned primary alias.
- Source code, production environment/secrets, domain settings, database/schema/data, Ledger and Holdings were not changed by this task. This local status update is uncommitted and unpushed.

## Retained historical release snapshot

The following text is retained as historical evidence; its words "current" and "active" describe the earlier snapshot, not the mappings verified above.

Production Release Status

**Status recorded:** 2026-10-26 Asia/Bangkok  
**Repository:** [nine41745-sketch/stock-portfolio](https://github.com/nine41745-sketch/stock-portfolio)  
**Release:** v1.40.2 — released to Production; scoped owner approval completed.

## Production

- Production URL: [stock-portfolio-nine41745.vercel.app](https://stock-portfolio-nine41745.vercel.app).
- Active deployment: [dpl_9RmeQ3tK7q9bPdWyQwm22cYGsM1n](https://vercel.com/nine41745/stock-portfolio/9RmeQ3tK7q9bPdWyQwm22cYGsM1n).
- Immutable deployment URL: [stock-portfolio-b3mcqqpau-nine41745.vercel.app](https://stock-portfolio-b3mcqqpau-nine41745.vercel.app).
- Exact application source SHA: `9e63f5173c6765b553d09a51ba992053976f9cd7`.
- Vercel project: `stock-portfolio`; scope: `nine41745`; environment: `production`; deployment status: `READY`.
- The existing staged build was promoted with the owner's specific approval, without rebuilding. The primary alias maps to this deployment; the mapping was checked again read-only for this documentation update.
- GitHub `main` was still at the exact application SHA above when this update began. This documentation branch does not change the deployed application's source SHA or runtime.

## Security Gate and Production Release Gate

| Gate | Current release decision | Authority and scope |
| --- | --- | --- |
| Security Gate | APPROVED — HOLD lifted | Owner's explicit approval, following the supplied independent ChatGPT Reviewer PASS, only for v1.40.2 at the exact SHA and deployment above. |
| Production Release Gate | APPROVED — HOLD lifted | Same explicit owner approval, only for this already-promoted v1.40.2 deployment. |

The owner accepted the stated QA limitations. These decisions do not claim that every possible security or application test passed, and do not authorize another release, merge, deployment, promotion, alias/domain change, Environment/Secrets change, or Production database/portfolio change. Future release decisions require their own applicable checks and authorization.

## Evidence accepted for this release

### Source provenance and build

- The accepted Vercel CLI metadata-filter and CLI GET evidence identifies deployment `dpl_9RmeQ3tK7q9bPdWyQwm22cYGsM1n` and reports both `meta.sourceGitSha` and `meta.gitCommitSha` as `9e63f5173c6765b553d09a51ba992053976f9cd7`.
- The Vercel Connector separately returned `meta: {}`. Both observations were disclosed; the cause of the different representations was not established. The accepted CLI evidence, rather than the empty Connector field, supplies the metadata SHA link.
- Existing build logs record successful compilation/build completion and deployment readiness. No build or deployment was repeated for this status update.

### Existing CI and Security Audit

- [CI run 40124938602](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40124938602) ran on exact SHA `9e63f5173c6765b553d09a51ba992053976f9cd7`.
- [verify](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40124938602/job/120964238587): PASS, including lockfile installation, lint, typecheck, regression tests and build, using Node.js 22.23.3 and npm 10.9.9. Lint recorded zero errors and three warnings.
- [security-audit](https://github.com/nine41745-sketch/stock-portfolio/actions/runs/40124938602/job/120964238353): PASS. The retained Full Audit and Production-only Audit summaries both report PASS, audit exit code 0, and zero affected packages across severities.
- No new Critical/High finding was identified in the evidence accepted by the independent reviewer. This is a statement about that reviewed evidence, not an unlimited or continuously refreshed security guarantee.
- The historical braces exception document remains in the repository; this accepted run reported PASS rather than PASS_WITH_EXCEPTION. Original raw npm audit JSON was not retained as an uploaded artifact; the retained job logs and audit summaries were reviewed instead.
- These are existing exact-release results. Automatic checks on the documentation PR are separate and do not replace the accepted release evidence; no manual release QA or CI rerun was requested.

### Production authenticated read-only smoke test

Codex used the owner's authorized existing browser session on 2026-10-25, 16:06:33–16:08:54 Asia/Bangkok. The owner entered the PIN personally.

| Check | Accepted result | Scope |
| --- | --- | --- |
| Login/PIN protected access | PASS | Existing unlocked session reached protected pages without Login/PIN redirection; fresh login and invalid PIN were not tested. |
| Dashboard | PASS | Page and expected sections rendered without the observed read-error/page-error states; financial values were not assessed or exported. |
| Transactions | PASS | Page loaded and displayed its expected history/journal sections; no transaction was submitted or edited. |
| Performance | PASS | Page loaded with expected Performance, Win Rate and FIFO labels; numeric accuracy was not assessed. |
| `/imports` to Dashboard | PASS | Authenticated navigation ended at `/dashboard`; Import Preview heading was absent. |
| Visible version | PASS | Runtime UI displayed `v1.40.2`. |

- Accepted totals: 6 PASS, 0 FAIL, 0 BLOCKED, 0 NOT RUN for these six positive Production UI checks.
- Captured browser console errors/warnings were zero. The filtered Vercel runtime query returned no grouped entries for the test window. Capture, retention and ingestion limits prevent either observation from proving an absence of all possible errors.
- Evidence was exported as sanitized route/label/error markers and console counts. Portfolio values, screenshots, raw DOM, credentials, PIN, cookies and tokens were excluded.
- The owner supplied an independent ChatGPT Reviewer PASS covering these six checks, exact-release CI/Security evidence and the Production alias, then explicitly lifted both gates for this release.

## Accepted limitations and remaining work

- Staged authenticated QA remained BLOCKED because Production isolation was not proven. The owner accepted that limitation before release; it has not been relabelled PASS.
- The later authorized Production smoke test allowed normal application Auth/database reads through those pages. It did not include direct database access, writes, BUY/SELL, Save/Edit/Delete/Import/Execute, or provider Refresh/Analyze actions.
- Real transaction behavior, portfolio arithmetic/data accuracy, fresh login/logout, negative authorization/RLS cases and cross-device behavior were not validated by this smoke test.
- The separate [Ledger/Holdings discrepancy](ledger-holdings-review.md) remains unresolved pending broker evidence. Release acceptance does not resolve it or authorize a balancing trade or any data correction.
- The older staged deployment `dpl_DND9RhnYUmEdpXLTXbVFC7onKXjr` was not used for this release; its historical source-provenance limitations remain historical and are not evidence for the active deployment.
- No further deployment or promotion is pending for this v1.40.2 release. The remaining administrative action for this status update is review/merge of its documentation PR, subject to separate owner approval; no new deployment is needed.

## Scope of this documentation update

Only `docs/RELEASE_STATUS.md` is changed. No runtime source, workflow, test assertion, `AGENTS.md`, `vercel.json`, Environment/Secrets, alias/domain, migration, Production database, Ledger or Holdings is changed.

The documentation branch uses the existing `dependabot/**` no-deployment pattern in `vercel.json` to avoid an Automatic Preview. The branch is an owner-requested documentation update, not a Dependabot dependency change. Automatic deployment of `main` remains disabled. No release QA is rerun, no PR is merged, and no deployment is requested by this update.
