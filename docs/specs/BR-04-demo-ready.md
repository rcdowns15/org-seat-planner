# BR-04 — Demo-ready: README, explainers, rehearsal

**Status:** todo · **Depends on:** BR-02, BR-03 · **Milestone:** M4 (interview-ready) · **Target:** Sat 11/14 – Sun 11/15 noon · **Cut line:** LR-04-01…04; LR-04-05 after the interview

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
- A fresh clone that follows the README quickstart reaches a working board and a green `pnpm pipeline`.
- Every code reference in the README and explainers resolves (`pnpm docs:check` in CI).
- Rob runs the demo script on production in five minutes or less, twice.

## Little rocks
Parallel: LR-04-02 and LR-04-03 together once BR-02 and BR-03 are merged.

### LR-04-01 · Demo mode: reset and fictional-data banner · status: todo · depends: LR-02-05 · owner: agent · executor model: sonnet
With `DEMO_MODE=true`: a site-wide banner ("Second Republic Bank is fictional; all data is
generated") and a "Reset demo data" action that restores the `app` tables to the seed (one
transaction; Workday tables are untouched because the app never writes them). Throttle resets to one
per minute. `db-deploy` with `reseed: true` remains the full reset.
- [ ] DB test: after several moves, reset returns the `app` checksum to the baseline
- [ ] DB test: reset returns 404 without `DEMO_MODE`; a second reset within a minute is refused
- [ ] e2e: the banner is visible on every page
Likely files: `src/server/actions/demo.ts`, `scripts/seed/index.ts`, `src/components/demo-banner.tsx`, `src/components/demo-toolbar.tsx`, `tests/db/reset.test.ts`.

### LR-04-02 · README v1: the case study · status: todo · depends: LR-03-05, LR-04-01 · owner: agent · executor model: sonnet
Rewrite `README.md`: what it is and why (one paragraph, fictional-company notice); live demo link;
architecture diagram (Mermaid: Workday report → ingest → `workday` raw/current → dbt staging →
marts; browser → server actions → `app` seats + audit; marts compare `app` with `workday`); data
model summary linking `docs/data-model.md`; "How write-back stays correct"; "How the pipeline stays
correct" (file validation, idempotent loads, tests, and the Workday report's population rule:
active, on leave, and terminated within 30 days); a sentence on why squads live in the app, not in
Workday (supervisory orgs follow the manager tree); what's tested and how to run it; a
**five-minute demo script** using seeded fixtures (move → forbidden move → conflict → history →
SQL panel → reconciliation exceptions after the 11-15 report); a **production mapping** table with a
**Built / Planned** column (CSV report → Workday RaaS/API; `pnpm pipeline` + GitHub Actions →
Airflow; Postgres `analytics` → Snowflake; dbt Core → dbt Cloud; MetricFlow → dbt Cloud Semantic
Layer; SQL panel and future dashboard → Tableau / Sheets; mock auth → SSO); a roadmap linking the
BR-05…BR-08 specs; local quickstart.
- [ ] The orchestrator follows the quickstart in a fresh clone (clean directory) and reaches a working board and a green `pnpm pipeline`; the PR shows the commands and output
- [ ] Every production-mapping row says Built or Planned, and every Built row links to code
- [ ] The demo script names only seeded fixtures that exist (checked against `scripts/seed/README.md`)
Likely files: `README.md`.

### LR-04-03 · Explainers for interview prep · status: todo · depends: LR-02-08, LR-03-05 · owner: agent · executor model: opus
Two docs written for Rob to learn from, each citing code as `path:line`:
- `docs/explainers/write-back.md`: the life of a move from drag to commit; why each validation
  exists and where it runs; optimistic vs. pessimistic locking; why `seat_changes` is append-only;
  what the database enforces vs. the app; what changes in production (SSO, row-level security,
  approvals, an outbox to push changes downstream).
- `docs/explainers/pipeline.md`: the ingest contract (validate the whole file, then load; raw vs.
  current; idempotency by hash); each Workday transform in staging; every mart's grain; how the
  reconciliation rules work and how they'd extend to TA and FP&A feeds; what moves to Workday API +
  Airflow + Snowflake in production.
Each ends with 10–12 likely interview questions and short answers. Add `pnpm docs:check`, a script
that verifies every `path:line` reference in `README.md` and `docs/explainers/` points to an
existing file and line, and run it in CI.
- [ ] `pnpm docs:check` passes, and fails on a deliberately broken reference (test)
- [ ] Every move failure code and every reconciliation exception type is explained, with its test named
- [ ] Each explainer has at least 10 interview questions
Likely files: `docs/explainers/write-back.md`, `docs/explainers/pipeline.md`, `scripts/docs-check.ts`, `tests/unit/docs-check.test.ts`, `.github/workflows/ci.yml`, `package.json`.

### LR-04-04 · Rehearsal and interview tag · status: todo · depends: LR-04-02, LR-04-03 · owner: rob · executor model: —
Sun 11/15 afternoon. Run the README demo script on production with a timer, twice. Explain the move
path and the pipeline aloud from the explainers, then without them. Log every gap as a docs fix, a
bug (new LR), or "fine". Reset the demo, then tag `v0.1-interview`.
- [ ] Two timed runs at five minutes or less, recorded in `docs/PROGRESS.md`
- [ ] Gaps logged; any P1 bug fixed, or the demo script routed around it
- [ ] `git tag v0.1-interview` pushed; production reset to the seed

### LR-04-05 · Production smoke test workflow (after the interview) · status: todo · depends: LR-04-01 · owner: agent · executor model: sonnet
`e2e-prod.yml` (manual, plus after each production deploy via `deployment_status`) runs a tagged
Playwright subset against `BASE_URL`: load the board, make one move, check its history, reset.
- [ ] A workflow run against the production URL is green (link it)
- [ ] The smoke run leaves production at the seed checksum (it ends with a reset)
Likely files: `.github/workflows/e2e-prod.yml`, `playwright.config.ts`, `tests/e2e/prod-smoke.spec.ts`.
