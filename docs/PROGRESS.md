# Progress Log

Newest first. Navigator updates "Where we stand" at each check-in.

## Where we stand
- **Last updated:** 2026-11-11 (late) · decisions accepted; BR-01 orchestrator brief written
- **Milestone:** M1 — Foundations (BR-01), 2 of 10 little rocks done (LR-01-01, LR-01-10). LR-01-05 linking done (only the live `/api/health` check is left, after LR-01-04). LR-01-02 is `ready`.
- **In flight:** none yet. Rob is starting the BR-01 orchestrator session with the navigator's brief.
- **Blocked:** none
- **Waiting on Rob:** paste the brief into `claude --agent orchestrator`; review and merge PRs as they open; LR-01-05 health check after LR-01-04 deploys; LR-01-09 (GitHub secrets, `db-deploy` with `reseed: true`) once LR-01-08 merges.
- **Next:** orchestrator runs LR-01-02, then LR-01-03 and LR-01-04 in parallel, then LR-01-06 → LR-01-07 → LR-01-08 · owner: orchestrator

Rewrite this block (don't append) whenever plan state changes; commit with the change.

## Production
- Live URL: (set in LR-01-05)
- GitHub repo: https://github.com/rcdowns15/org-seat-planner

## Runbook
- Neon cold start → first request after idle takes a few seconds → load the board once before demoing.
- Demo data messed up by visitors → board looks wrong → "Reset demo data" button, or run `db-deploy` with `reseed: true`.
- `pnpm test:db` fails to connect → Docker isn't running → `docker compose up -d db`.

## Log
- 2026-11-11 — Rob accepted all decisions D-001…D-028. LR-01-02 → `ready`. BR-01 orchestrator brief handed off.
- 2026-11-11 — LR-01-10 done: `docker run --rm hello-world` passed after the restart. Nothing blocks LR-01-02 on the machine side now.
- 2026-11-11 — LR-01-05 started: Vercel project `rob-c8e4/org-seat-planner` created and linked locally; `DEMO_MODE=true` set for production and preview. Blocked on Rob in the browser: accept Neon Marketplace terms, add a GitHub login connection to the Vercel account.
- 2026-11-11 — LR-01-01 done: public repo `rcdowns15/org-seat-planner` created and `main` pushed. Branch protection deferred (would block the orchestrator's status commits to `main`).
- 2026-11-11 — Rob: 5 h/day confirmed; repo name `org-seat-planner`; D-012 accepted; drop order confirmed (write-back extras before pipeline). Machine check found Docker missing, long paths off, pnpm missing → added LR-01-10 (rob).
- 2026-11-11 — Repo scaffolded from the harness template (docs and agents only).
- 2026-11-11 — Planning session: master plan, eight big rock specs, decisions D-001–D-028 (all proposed), parking lot. Re-cut for a 4-day timeline as a thin slice through every layer (write-back, Workday ingestion, dbt reconciliation); read-only SQL panel added (LR-02-08) at Rob's request; undo and audit page moved after the interview.
