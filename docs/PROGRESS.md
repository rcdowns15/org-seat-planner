# Progress Log

Newest first. Navigator updates "Where we stand" at each check-in.

## Where we stand
- **Last updated:** 2026-11-12 · navigator: LR-01-05 production health check passed; BR-01 orchestrator session 2 brief handed to Rob
- **Milestone:** M1 — Foundations (BR-01), 5 of 10 little rocks done (LR-01-01…04, LR-01-10). LR-01-05: all criteria met except the README line (in the next orchestrator brief).
- **In flight:** LR-01-06 on branch `lr/LR-01-06-drizzle-schema` (`a205c60`, pushed, **no PR yet**). Opus executor done; orchestrator verified lint, typecheck, test (7), test:db (25), build, `drizzle-kit check`. Next session: reviewer (little-rock mode) → fixes (0 of 2 retries used) → PR. Reviewer should check: leader scope uses `division_id`/`group_id` + CHECK instead of the spec's single `scope_id` (spec deviation); hand-edited `meta/0000_snapshot.json` so drizzle-kit doesn't re-create schemas; TRUNCATE guard via `SET LOCAL app.allow_seat_changes_reset`; no FKs from `app` to `workday`; new `pnpm-workspace.yaml` (`allowBuilds: esbuild`).
- **Blocked:** none
- **Waiting on Rob:** run the BR-01 orchestrator session 2 brief (LR-01-06 review + PR, then LR-01-07, LR-01-08); merge each PR promptly, since LR-01-07 and LR-01-08 wait on the one before; LR-01-09 once LR-01-08 merges.
- **Next:** LR-01-06 review + PR → LR-01-07 (seed; must reset `seat_changes` with the `SET LOCAL` setting) → LR-01-08 (CI DB job: migrate, seed, test:db, Playwright; `db-deploy`) · owner: orchestrator

Rewrite this block (don't append) whenever plan state changes; commit with the change.

## Production
- Live URL: https://org-seat-planner.vercel.app (health: `/api/health`)
- GitHub repo: https://github.com/rcdowns15/org-seat-planner

## Runbook
- Neon cold start → first request after idle takes a few seconds → load the board once before demoing.
- Demo data messed up by visitors → board looks wrong → "Reset demo data" button, or run `db-deploy` with `reseed: true`.
- `pnpm test:db` fails to connect → Docker isn't running → `docker compose up -d db`.

## Log
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
