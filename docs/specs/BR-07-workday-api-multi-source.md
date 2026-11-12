# BR-07 — Workday API path, multi-source reconciliation, and resolution

**Status:** todo · **Depends on:** BR-03 (BR-02 for LR-07-05) · **Milestone:** M7 · **Target:** after the interview · **Cut line:** no

## Goal
Move from "CSV report on a schedule" toward "API-driven, multi-source, resolvable in the app". A
mock Workday API reader plugs into the existing ingest interface, Talent Acquisition and FP&A
feeds join the reconciliation, the app shows exceptions live and lets leaders resolve them, and
database roles enforce who can write what.

## Why it matters
It shows that the BR-03 design was built to evolve: swap the reader and add sources, while the
models, tests and contracts stay put.

## Scope
In: DB roles, mock RaaS/JSON API reader, TA offers feed, FP&A approved-plan feed, live exceptions
page, "release seat" resolution, scheduled pipeline, demo refresh button.
Out: a real Workday tenant (needs credentials; documented only).

## Exit criteria
- The app's runtime role can't write `workday` or update/delete `seat_changes` (DB test).
- Swapping the CSV reader for the API reader produces identical staged data (test).
- Exceptions from all three sources appear in the app; "release seat" resolves a terminated-worker exception with an audited change.

## Little rocks

### LR-07-01 · Database roles: app runtime vs. ingest · status: todo · depends: LR-03-01 · owner: agent · executor model: opus
Custom migration: role `seat_app` (read/write `app` except `UPDATE`/`DELETE`/`TRUNCATE` on
`seat_changes`, so the app role can never use the seed's `SET LOCAL app.allow_seat_changes_reset`
reset path, which stays with the seed and ingest roles (LR-01-06 reviewer P3);
`SELECT` only on `workday` and `analytics`) and role `workday_ingest` (write `workday` only). The
app connects as `seat_app`; ingest uses its own URL.
- [ ] DB test as `seat_app`: `INSERT` into `workday.workers` and `UPDATE` on `app.seat_changes` both fail with permission denied
- [ ] All BR-02 tests pass while connected as `seat_app`
Likely files: `db/migrations/*`, `db/init/02-roles.sql`, `src/server/db.ts`, `.env.example`, `tests/db/roles.test.ts`.

### LR-07-02 · Create roles on Neon and set env vars · status: todo · depends: LR-07-01 · owner: rob · executor model: —
Create `seat_app` and `workday_ingest` passwords on Neon, set `APP_DATABASE_URL` and
`WORKDAY_INGEST_DATABASE_URL` in Vercel and GitHub secrets, redeploy.
- [ ] Production `/api/health` reports `role: seat_app`

### LR-07-03 · Mock Workday API reader · status: todo · depends: LR-03-01 · owner: agent · executor model: sonnet
A local mock endpoint serving the report as RaaS-style JSON (paged), and an `ApiReader` implementing
the ingest reader interface with retries and pagination. `pnpm workday:ingest --source api`.
- [ ] Ingesting the same report via CSV and via API yields identical `stg_workday__worker_report` rows (test)
- [ ] A transient 500 is retried; a persistent one fails the run with a logged reason (test)
Likely files: `scripts/ingest/api-reader.ts`, `scripts/mock-workday-api/*`, `tests/db/ingest-api.test.ts`.

### LR-07-04 · Talent Acquisition and FP&A feeds in reconciliation · status: todo · depends: LR-03-04 · owner: agent · executor model: sonnet
Mock TA offers report (candidate, squad, start date, status) and FP&A approved headcount by squad and
quarter. New exceptions: `offer_accepted` seat with no TA offer; TA start date passed with no Workday
hire; app plan differs from the FP&A approved plan.
- [ ] Each new exception type has a seeded case appearing exactly once (singular tests)
Likely files: `scripts/seed/ta-fpa.ts`, `scripts/ingest/*`, `analytics/models/staging/**`, `analytics/models/marts/rpt_reconciliation_exceptions.sql`.

### LR-07-05 · Live exceptions page and "release seat" · status: todo · depends: LR-07-01, LR-03-04 · owner: agent · executor model: sonnet
`/exceptions` reads `rpt_reconciliation_exceptions` (plus a live check for seats changed since the
last pipeline run) and links each row to the seat. "Release seat" on a terminated-worker exception
sets the seat to `backfill` through the validated, version-checked, audited path
(`change_type = 'release'`).
- [ ] DB test: release writes one audit row and bumps the version; a stale version returns `CONFLICT`
- [ ] e2e: after release, the exception shows as resolved
Likely files: `src/app/exceptions/page.tsx`, `src/server/services/release.ts`, `src/server/actions/release.ts`, `tests/db/release.test.ts`.

### LR-07-06 · Scheduled pipeline and demo refresh button · status: todo · depends: LR-03-05, LR-07-01 · owner: agent · executor model: sonnet
`pipeline.yml` gains a biweekly schedule. A `DEMO_MODE` button triggers the workflow through the
GitHub API (`workflow_dispatch`) and shows its status, so the demo can "run the biweekly refresh".
- [ ] A scheduled run is green; the button starts a run and shows the outcome
Likely files: `.github/workflows/pipeline.yml`, `src/server/actions/demo.ts`, `src/components/demo-toolbar.tsx`.
