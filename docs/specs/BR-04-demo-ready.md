# BR-04 — Demo-ready: README, explainers, rehearsal

**Status:** in-progress (3/6 cut-line LRs done) · **Depends on:** BR-02, BR-03 · **Milestone:** M4 (interview-ready) · **Target:** Sat 11/14 – Sun 11/15 noon · **Cut line:** LR-04-01…04, LR-04-06 (split from LR-04-03) and LR-04-07 (D-040); LR-04-05 after the interview

## Goal
The deployed demo holds up when strangers click around (a reset, a banner saying the data is
fictional). The README tells the story, two explainers teach Rob every piece, and Rob can run the
demo in five minutes and explain it without notes.

## Why it matters
The hiring manager sees the live demo and the README; Rob gets asked about the code. Both happen in
this big rock.

## Scope
In: demo reset and banner, README v1 (with production mapping and roadmap), write-back and
pipeline explainers, `pnpm docs:check`, rehearsal, release tag. After the interview: production
smoke workflow.

## Exit criteria
- A fresh clone that follows the README quickstart reaches a working board and a green `pnpm run pipeline` (pnpm 12 reserves `pnpm pipeline`; approved 2026-11-14).
- Every code reference in the README and explainers resolves (`pnpm docs:check` in CI).
- Rob runs the demo script on production in five minutes or less, twice.

## Little rocks
Parallel: LR-04-03 (write-back explainer) runs now, alongside LR-02-06, LR-03-05 and LR-04-01. LR-04-02 and LR-04-06 run together once LR-03-05 is merged. LR-04-07 follows LR-04-03 (it extends the write-back explainer).

### LR-04-01 · Demo mode: reset and fictional-data banner · status: done (https://github.com/rcdowns15/org-seat-planner/pull/21) · depends: LR-02-05 (merged, #17) · owner: agent · executor model: sonnet
With `DEMO_MODE=true`: a site-wide banner ("Second Republic Bank is fictional; all data is
generated") and a "Reset demo data" action that restores the `app` tables to the seed (one
transaction; Workday tables are untouched because the app never writes them). Throttle resets to one
per minute. `db-deploy` with `reseed: true` remains the full reset.
- [ ] DB test: after several moves, reset returns the `app` checksum to the baseline
- [ ] DB test: without `DEMO_MODE`, the reset server action returns a `NOT_FOUND` result and writes nothing (D-023 clarification); a second reset within a minute is refused
- [ ] e2e: the banner is visible on every page
Likely files: `src/server/actions/demo.ts`, `scripts/seed/index.ts`, `src/components/demo-banner.tsx`, `src/components/demo-toolbar.tsx`, `tests/db/reset.test.ts`.
**Built 2026-11-13 (`lr/LR-04-01-demo-reset` @ 21f249f, not verified).** Design accepted 2026-11-14 as D-039: no leader permission check (only `DEMO_MODE` + throttle), clears `app.seat_changes` through the migration 0002 TRUNCATE escape hatch (trigger unchanged), new `app.demo_reset_state` table. Before the PR:
- [x] The `CLAUDE.md` project rules carry the D-039 carve-out (the reviewer checks against it) (82d4cf0)
- [x] The migration is renumbered 0006: stack on LR-02-06 and regenerate it with `pnpm db:generate` (custom SQL in a custom migration); 0005 stays LR-02-06's

### LR-04-02 · README v1: the case study · status: ready · depends: LR-03-05 (merged, #22), LR-04-01 (merged, #21) · owner: agent · executor model: sonnet
Rewrite `README.md`: what it is and why (one paragraph, fictional-company notice); live demo link;
architecture diagram (Mermaid: Workday report → ingest → `workday` raw/current → dbt staging →
marts; browser → server actions → `app` seats + audit; marts compare `app` with `workday`); data
model summary linking `docs/data-model.md`; "How write-back stays correct"; "How the pipeline stays
correct" (file validation, idempotent loads, tests, and the Workday report's population rule:
active, on leave, and terminated within 30 days); a sentence on why squads live in the app, not in
Workday (supervisory orgs follow the manager tree); what's tested and how to run it; a
**five-minute demo script** using seeded fixtures (move → forbidden move → conflict → history →
SQL panel → reconciliation exceptions after the 11-15 report); a **production mapping** table with a
**Built / Planned** column (CSV report → Workday RaaS/API; `pnpm run pipeline` + GitHub Actions →
Airflow; Postgres `analytics` → Snowflake; dbt Core → dbt Cloud; MetricFlow → dbt Cloud Semantic
Layer; SQL panel and future dashboard → Tableau / Sheets; mock auth → SSO); a roadmap linking the
BR-05…BR-08 specs, which names the TA offers feed (LR-07-04) as the next step after today's
hiring-gap check (D-033); local quickstart.
- [ ] The orchestrator follows the quickstart in a fresh clone (clean directory) and reaches a working board and a green `pnpm run pipeline`; the PR shows the commands and output
- [ ] The quickstart includes `cd analytics && uv sync && uv run dbt deps` before the first `pnpm run pipeline` (a fresh clone fails without it; LR-03-05 report, 2026-11-14), and says `.env.local` needs `DBT_USER`/`DBT_PASSWORD` from `.env.example`
- [ ] The demo script's reconciliation step matches production, where the pipeline has already loaded the 11-15 report (see the LR-03-05 demo note); the SQL panel analytics presets are on `/sql`, not on the board
- [ ] Every production-mapping row says Built or Planned, and every Built row links to code
- [ ] The roadmap names cost-aware planning as a Planned next layer (added 2026-11-14): today's constraint is approved seats (a headcount budget); next comes standard cost by job level and location, quarterly budgets per cost center from FP&A, and an over-budget warning on moves, with individual pay never shown to leaders (see `docs/PARKING_LOT.md`)
- [ ] The demo script names only seeded fixtures that exist (checked against `scripts/seed/README.md`)
- [ ] (BR-03 review P3s, 2026-11-15) `pnpm run pipeline` appears in both `README.md` and `analytics/README.md`; the demo script's reconciliation step says the seated-worker exceptions are resolved outside the app today (BR-07 adds resolution)
Likely files: `README.md`.

### LR-04-03 · Write-back explainer and `pnpm docs:check` · status: done (https://github.com/rcdowns15/org-seat-planner/pull/20) · depends: LR-02-08 (merged, #16), LR-02-05 (merged, #17) · owner: agent · executor model: opus
Split on 2026-11-13 so Rob can study the write-back path a day early, because he hasn't been
reading the PRs line by line. The pipeline explainer moved to LR-04-06.
`docs/explainers/write-back.md`, written for Rob to learn from and citing code as `path:line`: the
life of a move from drag to commit; the acting-leader cookie and the permission check on both
squads; why each validation exists, where it runs, and in what order (`FORBIDDEN`, then `CONFLICT`,
then the domain checks, D-037); optimistic vs. pessimistic locking; why `seat_changes` is
append-only (trigger, grants, two rows per move, no backdating, D-038) and the one recorded exception, the demo reset (D-039); the conflict demo; what the
database enforces vs. the app; what changes in production (SSO, row-level security, approvals, an
outbox to push changes downstream). It ends with 10–12 likely interview questions and short
answers. The seat history panel (LR-02-06) gets a short section in whichever of the two merges
second. Add `pnpm docs:check`, a script that checks every `path:line` reference in `README.md` and
`docs/explainers/` points to an existing file and line, and run it in CI.
- [ ] `pnpm docs:check` passes, and fails on a deliberately broken reference (test)
- [ ] Every move failure code is explained, with its test named
- [ ] At least 10 interview questions
- [ ] A "read these first" list at the top: the 5–8 `path:line` spots Rob must be able to explain, in reading order
Likely files: `docs/explainers/write-back.md`, `scripts/docs-check.ts`, `tests/unit/docs-check.test.ts`, `.github/workflows/ci.yml`, `package.json`.

### LR-04-06 · Pipeline explainer (split from LR-04-03) · status: done (https://github.com/rcdowns15/org-seat-planner/pull/23) · depends: LR-03-05 (merged, #22), LR-04-03 (merged, #20) · owner: agent · executor model: opus
`docs/explainers/pipeline.md`, citing code as `path:line`: the ingest contract (validate the whole
file, then load; raw vs. current; idempotency by hash); each Workday transform in staging; every
mart's grain; headcount rebuilt as of each report date (D-036); how the reconciliation rules work
and how they'd extend to TA and FP&A feeds (starting from the hiring-gap check, which works without
a TA feed, D-033); `pnpm run pipeline` mapped to Airflow; what moves to Workday API + Airflow +
Snowflake in production. It ends with 10–12 likely interview questions and short answers, and has
the same "read these first" list as LR-04-03.
- [ ] `pnpm docs:check` passes with the new file
- [ ] Every reconciliation exception type is explained, with its test named
- [ ] At least 10 interview questions and a "read these first" list
Likely files: `docs/explainers/pipeline.md`.

### LR-04-04 · Rehearsal and interview tag · status: todo · depends: LR-04-02, LR-04-03, LR-04-06, LR-04-07 · owner: rob · executor model: —
Sun 11/15 afternoon. Run the README demo script on production with a timer, twice. Explain the move
path and the pipeline aloud from the explainers, then without them. Log every gap as a docs fix, a
bug (new LR), or "fine". Reset the demo, then tag `v0.1-interview`.
- [ ] Two timed runs at five minutes or less, recorded in `docs/PROGRESS.md`
- [ ] Code walkthrough drill: with only the code open (no explainer), Rob walks the move service and one dbt mart aloud, then answers five explainer interview questions without looking. Then runs `scripts/demo/break-it.sql` locally and explains each result (D-040). Misses go in the gap log.
- [ ] Gaps logged; any P1 bug fixed, or the demo script routed around it
- [ ] `git tag v0.1-interview` pushed; production reset to the seed

### LR-04-07 · "Try to break it" SQL script · status: ready · depends: LR-04-03 (merged, #20) · owner: agent · executor model: sonnet · cut line: yes (D-040)
Added 2026-11-14 instead of a writable SQL console (D-026 stands, D-040). `scripts/demo/break-it.sql`, run by Rob with `psql` against the **local** database during the interview, attacks the write path directly and shows what stops it. Every statement runs inside one transaction that ends in `ROLLBACK`, so the script changes nothing. Attempts, each with a comment saying what should happen and why: `DELETE` and `UPDATE` on `app.seat_changes` (append-only trigger rejects); seating a second worker in a filled seat or one worker in two seats (whatever constraint exists rejects it, or the comment says honestly that only the app enforces it); a raw `UPDATE app.seats` with no version check (succeeds: locking lives in the app's statement shape, which is the talking point). Use `SAVEPOINT`s so one rejected statement doesn't abort the rest. Add a "Try to break it" section to `docs/explainers/write-back.md`: how to run it, each attempt's expected result, and the database-vs-app enforcement table it demonstrates.
- [ ] The script runs end to end on a freshly seeded local DB, and every attempt's actual result matches its comment (PR shows the output)
- [ ] Running it twice leaves `pnpm db:seed:check` unchanged (it writes nothing)
- [ ] It refuses to run against a non-local host, or the explainer and the script header both say "local only" and it carries no connection string
- [ ] `pnpm docs:check` passes with the new explainer section
- [ ] Two misleading comments fixed (Rob 2026-11-14, from the LR-04-01/LR-03-05 P3s): (1) the lock comment in `scripts/seed/app-rows.ts` and the matching write-back explainer sentence no longer say a reset and a move "can't deadlock"; they say it's safe because every writer locks seats first, and the worst case is Postgres aborting one transaction so the reset returns `FAILED`; (2) the "check order" comment at `src/lib/schemas/move.ts:26` matches the current order after D-037 part 2 (`FORBIDDEN`, then `CONFLICT`, then the domain checks). Comment and doc text only, no behavior change.
- [ ] (BR-03 big-rock review P2, 2026-11-15) `docs/explainers/write-back.md` citations into `src/app/board/page.tsx` point at the intended lines again (the move prop and the history panel; `:94` → `:95`, `:102` → `:103` as of main 4980828, re-check after LR-02-11 merges)
Likely files: `scripts/demo/break-it.sql`, `docs/explainers/write-back.md`, `scripts/seed/app-rows.ts`, `src/lib/schemas/move.ts`.

### LR-04-05 · Production smoke test workflow (after the interview) · status: todo · depends: LR-04-01 · owner: agent · executor model: sonnet
`e2e-prod.yml` (manual, plus after each production deploy via `deployment_status`) runs a tagged
Playwright subset against `BASE_URL`: load the board, make one move, check its history, reset.
- [ ] A workflow run against the production URL is green (link it)
- [ ] The smoke run leaves production at the seed checksum (it ends with a reset)
Likely files: `.github/workflows/e2e-prod.yml`, `playwright.config.ts`, `tests/e2e/prod-smoke.spec.ts`.
