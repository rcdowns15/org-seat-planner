# Progress Log

Newest first. Navigator updates "Where we stand" at each check-in.

## Where we stand
- **Last updated:** 2026-11-11 (late) · end of planning/setup session, before Rob's restart
- **Milestone:** M0 — Planned (interview Mon 2026-11-16; cut line BR-01–BR-04 by Sun 11/15 noon). Done: LR-01-01 (repo). LR-01-05 linking done (only the live `/api/health` check is left, after LR-01-04). LR-01-10 all done except the Docker check.
- **In flight:** none (no orchestrator has run yet)
- **Blocked:** none
- **Waiting on Rob:** (1) after the restart, open Docker Desktop, accept its terms, and run `! docker run --rm hello-world` in the navigator session. If it passes, the navigator ticks LR-01-10 and marks it `done`. (2) Confirm or change the remaining `proposed` decisions in `docs/DECISIONS.md` (D-001 and D-012 are accepted).
- **Next:** navigator writes the Thursday orchestrator brief: LR-01-02 first, then LR-01-03 and LR-01-04 in parallel, then LR-01-06 → LR-01-07 → LR-01-08; Rob does LR-01-09 (GitHub secrets, first Neon seed) once LR-01-08 merges · owner: orchestrator

Rewrite this block (don't append) whenever plan state changes; commit with the change.

## Production
- Live URL: (set in LR-01-05)
- GitHub repo: https://github.com/rcdowns15/org-seat-planner

## Runbook
- Neon cold start → first request after idle takes a few seconds → load the board once before demoing.
- Demo data messed up by visitors → board looks wrong → "Reset demo data" button, or run `db-deploy` with `reseed: true`.
- `pnpm test:db` fails to connect → Docker isn't running → `docker compose up -d db`.

## Log
- 2026-11-11 — LR-01-05 started: Vercel project `rob-c8e4/org-seat-planner` created and linked locally; `DEMO_MODE=true` set for production and preview. Blocked on Rob in the browser: accept Neon Marketplace terms, add a GitHub login connection to the Vercel account.
- 2026-11-11 — LR-01-01 done: public repo `rcdowns15/org-seat-planner` created and `main` pushed. Branch protection deferred (would block the orchestrator's status commits to `main`).
- 2026-11-11 — Rob: 5 h/day confirmed; repo name `org-seat-planner`; D-012 accepted; drop order confirmed (write-back extras before pipeline). Machine check found Docker missing, long paths off, pnpm missing → added LR-01-10 (rob).
- 2026-11-11 — Repo scaffolded from the harness template (docs and agents only).
- 2026-11-11 — Planning session: master plan, eight big rock specs, decisions D-001–D-028 (all proposed), parking lot. Re-cut for a 4-day timeline as a thin slice through every layer (write-back, Workday ingestion, dbt reconciliation); read-only SQL panel added (LR-02-08) at Rob's request; undo and audit page moved after the interview.
