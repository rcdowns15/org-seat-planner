# Progress Log

Newest first. Navigator updates "Where we stand" at each check-in.

## Where we stand
- **Last updated:** 2026-11-13 · #16 (LR-02-08), #17 (LR-02-05), #18 (LR-03-04) merged; main CI green; D-034 tripwire met (orchestrator)
- **Milestone:** M2 (BR-02): 7 of 8 cut-line LRs done; LR-02-06 ready. M3 (BR-03): 5 of 6 done; LR-03-05 ready. Cut line overall: 22 of 27 (81%).
- **In flight:** none. No open PRs.
- **Blocked:** none. Tripwire Sat 11/14 18:00 (D-034) met early: LR-02-08 and LR-03-04 both merged 2026-11-13, so "Last save: SQL executed" stays above the cut line.
- **Waiting on Rob:** paste the next orchestrator brief (fresh session).
- **Next:** LR-02-06 seat history panel (Sonnet; branch from main; criteria include the `seat_changes(seat_id)` index and two seat-card P3s from the LR-02-08 review) and LR-03-05 `pnpm pipeline` + Neon + SQL panel presets (Sonnet; touches `under-the-hood.ts`/`sql-panel.tsx`, and LR-02-06 touches board components, so check overlap; one Playwright run at a time on port 3000). Databases `seatplanner_lr0206` exists; create one for LR-03-05.

Rewrite this block (don't append) whenever plan state changes; commit with the change.

## Production
- Live URL: https://org-seat-planner.vercel.app (health: `/api/health`)
- GitHub repo: https://github.com/rcdowns15/org-seat-planner

## Runbook
- Neon cold start → first request after idle takes a few seconds → load the board once before demoing.
- Demo data messed up by visitors → board looks wrong → "Reset demo data" button, or run `db-deploy` with `reseed: true`.
- `pnpm test:db` fails to connect → Docker isn't running → `docker compose up -d db`.

## Log
- 2026-11-13: LR-02-08 (PR #16), LR-03-04 (PR #18) and LR-02-05 (PR #17) are done; main CI green on the #17 merge. D-034 tripwire met. LR-03-05 is now `ready` (deps LR-03-04, LR-02-08, LR-01-09 all done). Cut line: 22 of 27.
- 2026-11-13: Rob approved the D-023 wording: demo-only actions return 404 from routes/pages and a `NOT_FOUND` result from server actions. `CLAUDE.md` project rule and the LR-02-05 criterion updated. Navigator: add a `docs/DECISIONS.md` note under D-023.
- 2026-11-13: Cleanup: superseded branch `lr/LR-03-04-exceptions` deleted (local and remote); all 40 stale agent worktrees removed (every commit on them was already on main, checked with `git cherry`); merged local branches deleted.
- 2026-11-13 — LR-03-04 → `review`: https://github.com/rcdowns15/org-seat-planner/pull/18 (Opus, build in the earlier session + 2 fix rounds; review 1 P1 + six P3s fixed after Rob decision; review 2 P2 + three P3s fixed, two noted; review 3 pass; dbt PASS=253).
- 2026-11-13 — LR-02-05 → `review`: https://github.com/rcdowns15/org-seat-planner/pull/17, stacked on #16 (Sonnet, build + 1 fix round; review 1 P2 + six P3s fixed, 404 wording routed to navigator; review 2 pass, 3 P3s noted).
- 2026-11-13 — LR-03-04 fix round 1 verified (dbt PASS=252); re-review P2 (gate seed-list tests on seed state); fix round 2 dispatched (Opus).
- 2026-11-13 — LR-02-08 → `review`: https://github.com/rcdowns15/org-seat-planner/pull/16 (Sonnet, build + 2 fix rounds; review 1 two P2s + four P3s fixed, two P3s routed to LR-02-06, one note to LR-02-07; review 2 one P2 + three P3s fixed; review 3 pass; e2e 19/19).
- 2026-11-13 — LR-02-05 built and verified (e2e 22/22); review 1 pass with one P2; fix round 1 dispatched (Sonnet).
- 2026-11-13 — LR-03-04: Rob decided (list all 8 hiring-gap groups; seated + missing = one `seated_missing_from_report` row only). Unblocked → `in-progress`, fix round 1 (Opus) on `lr/LR-03-04-fix1`, rebased onto main. This orchestrator session takes over LR-03-04 from the earlier one.
- 2026-11-13 — LR-03-04 → `blocked`: Opus build verified (dbt PASS=250). Review 1 has one P1: the seed README doesn't list the seeded exceptions, so "exactly the seeded exceptions" can't be tested. Needs a Rob decision on the hiring-gap rule and on 100878; P3s recorded in the spec.
- 2026-11-13 — LR-02-08 review 1: pass, no P1; 2 P2s (missing tests) + 3 P3s in fix round 1 (Sonnet, `lr/LR-02-08-fix1`); 2 seat-card P3s routed to LR-02-06 and 1 undo note to LR-02-07 as criteria.
- 2026-11-13 — LR-02-08 built (Sonnet, `lr/LR-02-08-sql-panel` @ 73df902; orchestrator re-ran all checks: unit 93, db 141, e2e 19/19); in review. LR-02-05 → `in-progress` (Sonnet), stacked on 73df902.
- 2026-11-13 — LR-02-08 → `in-progress` (Sonnet). Criteria (orchestrator, from the brief): LR-02-05 gains "Move to… hidden or disabled when the leader can edit no squad" (LR-02-04 P3) and a D-038 reviewer check; LR-02-06 gains a `seat_changes(seat_id)` index migration (LR-02-10 P3). Board LRs run in sequence (08 → 05 → 06) because they share `board-view.tsx`/`seat-card.tsx` and port 3000.
- 2026-11-13: D-038 accepted. No `seat_changes` row may be dated earlier than the latest change on its seat or worker, for every writer. This widens D-037 part 1, which is now marked superseded. No timeline impact: the LR-02-05 and LR-02-07 criteria already implement it. The project rule is pending in `CLAUDE.md` (step 0 of the next brief).
- 2026-11-13: LR-02-10 is done (PR #13 merged), as are LR-03-03 (PR #14 merged) and LR-02-04 (PR #15 merged). The write-back thin slice is complete. LR-02-05, LR-02-06 and LR-02-08 are now `ready`. LR-03-04 rebases onto `main` because its stack base merged. Cut line: 19 of 27 done.
- 2026-11-13 — LR-02-04 → `review`: https://github.com/rcdowns15/org-seat-planner/pull/15 (Sonnet, build + 1 fix round; review pass, 2 P2s and 2 P3s fixed, 1 P3 noted; e2e 14/14).
- 2026-11-13 — LR-03-04 → `in-progress` (Opus), stacked on #14.
- 2026-11-13 — LR-03-03 → `review`: https://github.com/rcdowns15/org-seat-planner/pull/14 (Sonnet, build + 2 fix rounds; review 1 P1 + three P2s fixed; review 2 one P2 fixed, one P2 waived and routed to LR-02-05/LR-02-07; dbt build PASS=203).
- 2026-11-13 — Criteria (orchestrator, from the LR-03-03 review 2): LR-02-05's `demo_touch` row and LR-02-07's undo rows must use an effective date no earlier than the latest one already on the seat or worker, with a DB test, so the as-of seat state (D-036) stays correct. Navigator: consider widening D-037 to every `seat_changes` writer.
- 2026-11-13 — LR-02-10 → `review`: https://github.com/rcdowns15/org-seat-planner/pull/13 (Sonnet, build + 1 fix round; review pass, P2 fixed, 2 P3s fixed, 1 P3 noted).
- 2026-11-13: LR-02-03 is done (PR #11 merged) and LR-03-06 is done (PR #12 merged). LR-02-04 and LR-02-10 are now `ready`. The BR-02 spec header now lists LR-02-10 on the cut line (D-037). Cut line: 16 of 27 done. Brief handed off: LR-03-03 fix round 1, LR-02-04 and LR-02-10 in parallel, then LR-03-04.
- 2026-11-13 — Criteria (orchestrator): LR-02-04 gains a criterion that the dialog shows any failure's `message` generically, so LR-02-10's new code needs no UI change (from the LR-02-10 review, P2).
- 2026-11-13 — Navigator, from the orchestrator report: D-036 accepted (headcount rebuilt as of each report date from `seat_changes`; LR-03-03 criteria restated and three added). D-037 accepted: new LR-02-10 rejects out-of-order effective dates (split from LR-02-03, cut line unchanged; about +0.5 Rob-hours, cut line ≈ 20.25 h, 3 days to the interview); LR-02-03 checks `CONFLICT` right after `FORBIDDEN` (spec updated). LR-03-03 fix round 1 unblocked.
- 2026-11-12 — LR-03-03 built (Sonnet, `lr/LR-03-03-marts` @ cdaf6bf, dbt PASS=185). Review 1: changes required (P1: live counts stamped on every report date; P2s: effective-date ordering, missing unit tests). Findings recorded in the spec; the fix round waits on a navigator/Rob call. No PR yet.
- 2026-11-12 — LR-03-06 → `review`: https://github.com/rcdowns15/org-seat-planner/pull/12 (Sonnet, one pass; review pass, 3 P3s noted). Migration 0004 drops `workers_position_id_active_key`; dbt test `assert_one_current_holder_per_position` on the latest report.
- 2026-11-12 — LR-02-03 → `review`: https://github.com/rcdowns15/org-seat-planner/pull/11 (Opus build + 1 fix round; review 1 P1 source-squad permission test and P2 early version check fixed, review 2 pass; P3s noted). Needs Rob: CONFLICT now also checked right after FORBIDDEN.
- 2026-11-12 — LR-03-02 done (PR #10 merged). LR-03-03 and LR-03-06 → `in-progress` (Sonnet, in parallel; LR-03-06 owns a separate singular dbt test so the two touch no shared analytics file). LR-02-03 → `in-progress` (Opus; built and verified, in review).
- 2026-11-12 — D-035 accepted: dbt-core 1.10 and dbt-postgres 1.9 on Python 3.12, pinned in `analytics/pyproject.toml` and locked in `uv.lock` (from LR-03-02, PR #10). MetricFlow compatibility to check at BR-06.
- 2026-11-12 — D-034 accepted (big change, cut line): LR-03-06 moves above the cut line with nothing dropped now; D-029's position index is amended. Tripwire: at Sat 11/14 18:00, if LR-02-08 or LR-03-04 isn't merged, "Last save: SQL executed" drops below the line. Timeline impact: +1 PR, about +0.75 Rob-hours (cut line ≈ 19.75 h); covered by the half-day lead, 3.5 days to the interview. LR-03-06 → `ready` (dispatch after #10 merges).
- 2026-11-12 — PR #10 (LR-03-02) CI green: checks, db, the new dbt job, Vercel preview (orchestrator).
- 2026-11-12 — Navigator, from the orchestrator report (it stopped at the usage limit): LR-03-01 done (PR #9 merged). BR-01 big-rock review passed and BR-01 is done. Master plan rollup: BR-02 and BR-03 → `in-progress`. PR #10 (LR-03-02) no longer stacks now that #9 is merged; its CI still needs checking.
- 2026-11-12 — LR-03-02 → `review`: https://github.com/rcdowns15/org-seat-planner/pull/10 (Sonnet build + 2 fix rounds; review 1 P2 fixed, review 2 P2 fixed and checked by the orchestrator; dbt build 121 pass). Stacked on #9.
- 2026-11-12 — LR-03-01 → `review`: PR #9 (Sonnet build + 2 fix rounds; review 1 three P2s fixed, review 2 one P2 fixed and one waived → LR-03-06, review 3 pass). Rebased onto main after #7/#8; checksum unchanged.
- 2026-11-12 — LR-02-01 done (PR #7 merged) and LR-02-02 done (PR #8 merged). LR-02-03 (Opus) is now ready: deps LR-02-01 merged.
- 2026-11-12 — New little rock LR-03-06 (`todo`, needs a navigator call: touches D-029): a position backfill can wedge ingestion under upsert-only workers. Found in the LR-03-01 round-2 review; waived in the LR-03-01 PR, which is outside this brief.
- 2026-11-12 — LR-02-01 → `review`: PR #7 (Sonnet build + 1 fix round; review 1 two P2s fixed, review 2 pass; P3s noted).
- 2026-11-12 — LR-02-02 → `review`: PR #8 (Sonnet build + 1 fix round; review 1 one P2 fixed, review 2 pass; P3s noted).
- 2026-11-12 — Rob approved the three LR-03-01 deviations (newer-report-only, upsert-only workers, extra required columns); written into the LR-03-01 spec text. The fix round still documents them in `docs/data-model.md` (review P2-3).
- 2026-11-12 — Rob approved the LR-02-02 change: `?group=` with Digital Channels as the default, acting-leader default moved to LR-02-04; squad header "approved" = seat count.
- 2026-11-12 — Orchestrator handoff at the context budget: LR-02-01, LR-02-02, LR-03-01, LR-03-02 built (Sonnet) and verified; reviews done for 02-01 (2 P2, fixed), 02-02 (1 P2, fix running), 03-01 (3 P2, fix next); LR-03-02 rebased onto LR-03-01 and dbt build green on seeded data, review pending. No PRs yet.
- 2026-11-12 — BR-01 big-rock review (orchestrator, Opus reviewer): pass, no P1; all four exit criteria met with evidence (local checks, CI run 43289446630, production health 2202 seats, checksum `8cb477f9…` identical on local/CI/Neon, ER diagram matches). BR-01 → `done`. P2-1 (parallel executors share one local DB) handled in briefs with one database per executor; P2-2 (no recorded checksum baseline) added as an LR-03-01 criterion. P3s listed in the orchestrator report. LR-02-02 criterion tightened: `?group=` with the demo group as the default; defaulting to the acting leader's scope moves to LR-02-04. LR-02-01, LR-02-02, LR-03-01 → `in-progress` (Sonnet).
- 2026-11-12 — Navigator: LR-02-01, LR-02-02 and LR-03-01 → `ready` (deps merged). Dependency fix: LR-03-02 now also depends on LR-03-01's migration (its sources `workday.raw_worker_report` and `workday.ingest_runs` don't exist yet), so it stacks on the LR-03-01 branch and merges after it. Combined brief (BR-01 big-rock review + four-LR dispatch) handed to Rob, starting the Friday work early.
- 2026-11-12 — LR-01-09 done (Rob): five GitHub secrets added (`NEON_DATABASE_URL_UNPOOLED`, `DBT_*`); `db-deploy` with `reseed: true` green (run 43288883379); production `/api/health` → `{"ok":true,"db":"ok","seats":2202}`, matching local. BR-01 has all 10 little rocks done; the big-rock review is next.
- 2026-11-12 — Master plan rollup: BR-01 `todo` → `in-progress` (9/10). LR-01-08 P3s noted for later: the CLI refusal test may need a longer Vitest timeout on slow runners; a repeated `?host=` in the URL could slip past the seed guard; no Playwright test touches the database until BR-02's board tests.
- 2026-11-12 — LR-01-08 done: PR #6 merged (CI green, run 43286534662). LR-01-05 done with it (README production URL). LR-01-09 (Rob) is now unblocked.
- 2026-11-12 — LR-01-08 → `review`: PR #6 (Sonnet build + one fix round; review 1 two P2s fixed: LR-01-05 status, CLI-level refusal test; four P3s fixed, four noted; review 2 pass; CI green). The PR also closes LR-01-05 (README URL) and adds the D-032 seed README note (seed checksum unchanged).
- 2026-11-12 — D-033 accepted: no TA feed before the interview; LR-07-04 stays after the cut line (cut line unchanged). The LR-04-02 roadmap and LR-04-03 explainer criteria now present the TA feed as the next step after the hiring-gap check. Resolves the "TA-slice decision pending" note from commit ba60871.
- 2026-11-12 — D-032 accepted: PR #5 merge = layout sign-off (LR-01-07 criterion annotated); leaders keep group cost centers for now (parked; raise again after the interview); `<group> Team <n>` supervisory org names confirmed. LR-01-08 brief handed off, carrying the LR-01-05 README line and a seed README note.
- 2026-11-12 — Criteria (navigator, from the LR-01-07 review notes): LR-03-01 ingest must not reuse the seed's CSV code; LR-03-04 pins the termination window (report date − 29 days through the report date, as the seed does); LR-01-07 spec wording now says the hand-written special-character names include given names.
- 2026-11-12 — LR-01-07 done: PR #5 merged. LR-01-08 is ready (deps LR-01-03, LR-01-07 merged).
- 2026-11-12 — LR-01-07 → `review`: PR #5 (Sonnet build + fixes, Opus D-031 pass; review 1 P1 test-env leak and P2 brand names fixed, review 2 P2 "Quartz Scheduler" fixed; layout sign-off pending).
- 2026-11-12 — Criteria tightened (orchestrator): LR-01-07 "first republic" grep allows the criterion's own spec line; LR-01-08 gains a `db:seed` remote-database guard (`--allow-remote`) and a plain-install note, both from the LR-01-07 review.
- 2026-11-12 — LR-02-08 criteria: added an "Impact of last move" preset (before/after seat counts and plan variance for the squads a move touched), rebuilt from `seat_changes`. Inside the existing little rock; cut line unchanged. Full dashboard stays BR-08.
- 2026-11-12 — D-031 accepted: the mock Workday reports model real report behavior (30-day termination window, future-dated hires, `Name (Manager)` supervisory orgs, employee and contingent ID schemes plus `Contract_End_Date`, BOM/CRLF/accented names). Criteria updated in LR-01-07 (in flight: apply before the PR), LR-03-01, LR-03-02, LR-03-04, LR-04-02. Rehires, FTE, leave types and event feeds parked.
- 2026-11-12 — D-030 accepted (leader scope as `division_id`/`group_id` + CHECK); LR-01-06 spec text updated to match. LR-07-01 now also withholds `TRUNCATE` on `app.seat_changes` from `seat_app`, with a test (LR-01-06 reviewer P3).
- 2026-11-12 — Rob approved the LR-01-06 spec deviation: `app.leaders` uses `division_id`/`group_id` + CHECK instead of `scope_id`. Spec/DECISIONS update handed to the navigator.
- 2026-11-12 — LR-01-06 done: PR #4 merged. LR-01-07 dispatched (Sonnet).
- 2026-11-12 — LR-01-06 → `review`: PR #4 (Opus; reviewer pass, P2 leader-scope CHECK test gap fixed; spec deviation `division_id`/`group_id` awaits Rob's OK).
- 2026-11-12 — LR-01-05: production health check passed (`200`, `"db":"ok"`); live URL recorded; secret check clean. Criterion reworded: the old `git grep "neon.tech"` matched the spec's own text. Only the README line is left. A machine restart killed the leftover `next start` (PID 4076); nothing lost (LR-01-06 was already pushed).
- 2026-11-12 — LR-01-06 implemented (Opus executor) and verified by the orchestrator; branch pushed, review and PR pending in the next orchestrator session (context budget reached).
- 2026-11-12 — LR-01-04 done: PR #3 merged (CI green). LR-01-05's production health check unblocked. LR-01-06 dispatched (Opus).
- 2026-11-12 — LR-01-03 done: PR #2 merged; CI now runs on every PR and push to `main`.
- 2026-11-12 — LR-01-04 → `review`: PR #3 (Sonnet; four reviewer P2s fixed: pool error listener, local-only test DB guard, `.env.example` unpooled URL, compose project name).
- 2026-11-12 — LR-01-03 → `review`: PR #2 (Sonnet; reviewer P2 empty failure artifact fixed; CI green, failing-lint demo run 43127741879).
- 2026-11-12 — LR-01-02 done: PR #1 merged. LR-01-03 and LR-01-04 dispatched in parallel.
- 2026-11-11 — LR-01-02 → `review`: PR #1 opened (Sonnet executor; reviewer pass, P2 duplicate `cn` helper fixed; Vercel preview builds).
- 2026-11-11 — D-029 accepted: the Workday report and `workday.workers` gain `Position_ID`, `Cost_Center` and `Location` (LR-01-06 and LR-01-07 criteria updated); the seat ↔ position link is parked until BR-07.
- 2026-11-11 — LR-01-07 criteria tightened (orchestrator, Rob's OK): documented Workday report layout with a header-match test and Rob's sign-off, plus a plausibility test (span of control 3–15, no manager cycles, date ordering). Open question for the navigator: add `Position_ID`, cost center and location to the report and `workday.workers` (touches LR-01-06).
- 2026-11-11 — Rob accepted all decisions D-001…D-028. LR-01-02 → `ready`. BR-01 orchestrator brief handed off.
- 2026-11-11 — LR-01-10 done: `docker run --rm hello-world` passed after the restart. Nothing blocks LR-01-02 on the machine side now.
- 2026-11-11 — LR-01-05 started: Vercel project `rob-c8e4/org-seat-planner` created and linked locally; `DEMO_MODE=true` set for production and preview. Blocked on Rob in the browser: accept Neon Marketplace terms, add a GitHub login connection to the Vercel account.
- 2026-11-11 — LR-01-01 done: public repo `rcdowns15/org-seat-planner` created and `main` pushed. Branch protection deferred (would block the orchestrator's status commits to `main`).
- 2026-11-11 — Rob: 5 h/day confirmed; repo name `org-seat-planner`; D-012 accepted; drop order confirmed (write-back extras before pipeline). Machine check found Docker missing, long paths off, pnpm missing → added LR-01-10 (rob).
- 2026-11-11 — Repo scaffolded from the harness template (docs and agents only).
- 2026-11-11 — Planning session: master plan, eight big rock specs, decisions D-001–D-028 (all proposed), parking lot. Re-cut for a 4-day timeline as a thin slice through every layer (write-back, Workday ingestion, dbt reconciliation); read-only SQL panel added (LR-02-08) at Rob's request; undo and audit page moved after the interview.
