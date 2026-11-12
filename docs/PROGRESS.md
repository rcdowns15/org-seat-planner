# Progress Log

Newest first. Navigator updates "Where we stand" at each check-in.

## Where we stand
- **Last updated:** 2026-11-12 · LR-01-07 PR #5 opened, waiting on Rob (orchestrator, session 2)
- **Milestone:** M1 — Foundations (BR-01), 6 of 10 little rocks done (LR-01-01…04, LR-01-06, LR-01-10). LR-01-05: all criteria met except the README line (orchestrator add-on).
- **In flight:** LR-01-07 → `review`, PR #5 (https://github.com/rcdowns15/org-seat-planner/pull/5) at d63a6e5. Two reviews (P1 + 2 P2s fixed), D-031 realism pass applied; 2 of 2 retries used.
- **Blocked:** none
- **Waiting on Rob:** PR #5 review + Workday report layout sign-off (criterion), incl. decisions: leader cost centers (squad group's CC vs a leadership CC), supervisory-org naming `<group> Team <n>`; LR-01-09 once LR-01-08 merges.
- **Next:** after PR #5 merges → LR-01-08 (CI DB job, `db-deploy`, `/api/health` seat count, `db:seed --allow-remote` guard) · owner: orchestrator.

Rewrite this block (don't append) whenever plan state changes; commit with the change.

## Production
- Live URL: https://org-seat-planner.vercel.app (health: `/api/health`)
- GitHub repo: https://github.com/rcdowns15/org-seat-planner

## Runbook
- Neon cold start → first request after idle takes a few seconds → load the board once before demoing.
- Demo data messed up by visitors → board looks wrong → "Reset demo data" button, or run `db-deploy` with `reseed: true`.
- `pnpm test:db` fails to connect → Docker isn't running → `docker compose up -d db`.

## Log
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
