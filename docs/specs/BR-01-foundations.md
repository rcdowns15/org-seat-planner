# BR-01 — Foundations

**Status:** in-progress · **Depends on:** — · **Milestone:** M1 · **Target:** Thu 2026-11-12 · **Cut line:** yes

## Goal
A TypeScript Next.js app with CI, a local Docker Postgres, migrations for the `app` and `workday`
schemas, a deterministic mock-data seed, and a hello-world deployed on Vercel + Neon with a
database health check.

## Why it matters
Every later little rock depends on these checks, the schema and the seed. Deploying on day 1 takes
the riskiest unknown (Vercel + Neon wiring) off the critical path.

## Scope
In: scaffold, tooling, CI, Docker Compose, Drizzle schema + migrations, seed generator (current
state only), health route, Vercel + Neon setup, a manual workflow that migrates and seeds Neon.
Out: product UI (BR-02), Workday report ingestion and dbt (BR-03), 18 months of history (BR-05),
DB role separation (BR-07).

## Key risks / open questions
- Windows long paths with pnpm inside deep worktree paths: run checks from a short path if needed.
- Neon via the Vercel integration sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`. The app
  uses the pooled URL; migrations, seed and dbt use the unpooled one (D-007).
- Docker Desktop must be running for `pnpm test:db` (installed and verified in LR-01-10).

## Exit criteria
- Every command under "Checks" in `CLAUDE.md` that exists passes locally and in CI on `main`.
- The deployed Vercel URL's `/api/health` returns `200` with `db: "ok"` and the seeded seat count.
- `pnpm db:seed` twice gives the same checksum; the seed invariants test passes.
- `docs/data-model.md` has an ER diagram matching the migrations.

## Little rocks
Parallel: LR-01-03 and LR-01-04 can run together after LR-01-02. LR-01-05 (Rob) can happen as soon
as LR-01-04 is merged, while LR-01-06 runs.

### LR-01-10 · Machine setup (tonight, before any executor runs) · status: done · depends: — · owner: rob · executor model: —
Checked 2026-11-11: Docker missing, `LongPathsEnabled = 0`, pnpm missing; Node 24, WSL and `gh` present.
1. Admin PowerShell: `New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`
2. Install Docker Desktop for Windows (WSL 2 backend), then restart once (this also applies the long-paths change).
3. `corepack enable` (provides pnpm; LR-01-02 pins the exact version in `packageManager`).
- [x] `docker run --rm hello-world` succeeds (2026-11-11, after restart)
- [x] `(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem").LongPathsEnabled` returns `1` (done 2026-11-11; takes full effect after a restart)
- [x] `pnpm --version` prints a version (12.18.0 via corepack, 2026-11-11)
Status 2026-11-11: Docker Desktop 4.99.0 and WSL 2 installed; a Windows restart is needed before `docker run --rm hello-world` can pass.

### LR-01-01 · Create the GitHub repo · status: done · depends: — · owner: rob · executor model: —
Created 2026-11-11: https://github.com/rcdowns15/org-seat-planner (public, `main` pushed, `origin` set).
Branch protection is deliberately **not** on yet: the orchestrator commits plan-status updates
directly to `main` with Rob's credentials, and a "require PR" rule would either block that or be
bypassed as admin anyway. Revisit after LR-01-03 (option: a ruleset requiring the CI check on PRs only).
- [x] `gh repo view --json visibility,name` shows `PUBLIC`
- [x] Repo description mentions "fictional company, mock data"
Likely files: none (GitHub settings).

### LR-01-02 · Next.js TypeScript scaffold and tooling · status: done (https://github.com/rcdowns15/org-seat-planner/pull/1) · depends: LR-01-01, LR-01-10 · owner: agent · executor model: sonnet
Scaffold Next.js (current stable, App Router, `src/` dir) in TypeScript strict mode at the repo root
with pnpm, Tailwind and shadcn/ui (init plus `button`, `card`, `dialog`, `select`, `badge`). Add
ESLint + Prettier, Vitest, and Playwright. Add the scripts named in "Commands" and "Checks"
(`lint`, `typecheck`, `test`, `test:e2e`, `build`; DB scripts can be stubs that print "added in
LR-01-04/06"). Pin Node in `.nvmrc` and pnpm in `packageManager`. The home page shows "Org Seat
Planner · Second Republic Bank (fictional)". Update `.gitignore` if needed.
- [ ] `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] `pnpm test` runs at least one real unit test (e.g. a `formatSeatStatus` helper), not just a placeholder `expect(true)`
- [ ] `pnpm test:e2e` starts the app and asserts the home page heading text
- [ ] `tsconfig.json` has `"strict": true`; `.nvmrc` and `packageManager` are set
- [ ] `vercel.json` sets `"framework": "nextjs"` (the Vercel project was created before the app existed, so its preset is "Other"), and the Vercel preview deployment for this PR builds successfully
Likely files: `vercel.json`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.prettierrc`, `vitest.config.ts`, `playwright.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/ui/*`, `tests/unit/*`, `tests/e2e/home.spec.ts`, `.nvmrc`.

### LR-01-03 · CI workflow · status: done (https://github.com/rcdowns15/org-seat-planner/pull/2) · depends: LR-01-02 · owner: agent · executor model: sonnet
GitHub Actions `ci.yml` on `pull_request` and pushes to `main`: install with the pinned pnpm and
Node (cache the pnpm store), then `lint`, `typecheck`, `test`, `build`, and a Playwright job
(install Chromium only).
- [ ] The workflow runs on the PR for this little rock and passes (link the run in the PR)
- [ ] A deliberately failing lint check on a scratch commit fails CI (show the run, then revert)
- [ ] Node and pnpm versions come from `.nvmrc` / `packageManager`, not hardcoded in the workflow
Likely files: `.github/workflows/ci.yml`.

### LR-01-04 · Local Postgres, DB client, health route · status: done (https://github.com/rcdowns15/org-seat-planner/pull/3) · depends: LR-01-02 · owner: agent · executor model: sonnet
`docker-compose.yml` with Postgres 16 (localhost-only defaults) and an init script creating the
`app`, `workday` and `analytics` schemas. A server-only DB module using `pg` + Drizzle that reads
`DATABASE_URL`. `GET /api/health` returns `{ ok, db, seats }` (`seats` is `null` until the schema
exists). `.env.example` documents every variable with localhost or placeholder values. Add a
`tests/db` Vitest project and the `pnpm test:db` script.
- [ ] `docker compose up -d db` then `pnpm dev`: `curl localhost:3000/api/health` returns `200` and `"db":"ok"`
- [ ] With the DB stopped, `/api/health` returns `503` and `"db":"down"` without crashing (test)
- [ ] `pnpm test:db` runs a connection test against the local DB
- [ ] `src/server/db.ts` starts with `import "server-only"`; no client component imports it (lint rule or test)
Likely files: `docker-compose.yml`, `db/init/01-schemas.sql`, `src/server/db.ts`, `src/app/api/health/route.ts`, `.env.example`, `vitest.config.ts`, `tests/db/connection.test.ts`.

### LR-01-05 · Link Vercel and Neon · status: in-progress (README line pending) · depends: LR-01-04 (final check only) · owner: rob · executor model: —
Linking done 2026-11-11 (ahead of LR-01-04): Vercel project `rob-c8e4/org-seat-planner`, connected
to the GitHub repo (pushes to `main` deploy to production, PRs get previews). Neon resource
`org-seat-planner-db` was provisioned through the Vercel Marketplace and connected, which set
`DATABASE_URL`, `DATABASE_URL_UNPOOLED` and the `PG*` / `POSTGRES_*` variables for all
environments. `DEMO_MODE=true` is set for production and preview. Schemas are **not** created by
hand: the migrations create `app`, `workday` and `analytics` (LR-01-06), and `db-deploy` runs them
on Neon (LR-01-09). Remaining: the health check once LR-01-04 is deployed.
- [x] Vercel project linked to GitHub; Neon connected; `DEMO_MODE` set
- [x] The production URL's `/api/health` returns `200` with `"db":"ok"` (2026-11-12: `curl.exe -i https://org-seat-planner.vercel.app/api/health` → `200 {"ok":true,"db":"ok","seats":null}`)
- [x] Production URL recorded in `docs/PROGRESS.md` and the README (README added in LR-01-08)
- [x] No connection string committed anywhere: `git grep -nE "neon\.tech" -- ":!docs/specs"` returns nothing, and every `postgres://…@` match is the localhost Docker default (2026-11-12)
Likely files: `docs/PROGRESS.md`, `README.md`.

### LR-01-06 · Drizzle schema and migrations for `app` and `workday` · status: done (PR #4) · depends: LR-01-04 · owner: agent · executor model: opus
Define the data model in Drizzle and generate migrations (see D-010 and the "Domain edge cases" in
`CLAUDE.md`):
- `workday.workers`: the typed, current view of Workday (worker_id, names, email, worker_type
  `employee|contingent`, status `active|leave|terminated`, hire_date, termination_date,
  manager_worker_id, job_title, supervisory_org, position_id, cost_center, location,
  as_of_report_date, updated_at). BR-03 adds the raw report landing tables. `position_id` is
  unique among non-terminated workers and is **not** linked to `app.seats` (D-029): seats match
  Workday by `worker_id` only.
- `app.divisions`, `app.groups`, `app.squads` (explicit three-level hierarchy)
- `app.leaders` (leader_id, worker_id, display name, scope_type `division|group`, division_id,
  group_id; each a foreign key, with a CHECK that exactly the one matching `scope_type` is set. D-030
  replaced the original single `scope_id`.)
- `app.seats` (seat_id, squad_id, seat_type `employee|contingent`, status
  `filled|open|backfill|offer_accepted`, worker_id nullable, version int default 0, updated_at,
  updated_by_leader_id)
- `app.seat_changes` (change_id, move_id, seat_id, change_type, worker_id, from_status, to_status,
  from_worker_id, to_worker_id, actor_leader_id, effective_date, created_at, reverses_change_id, note)
- `app.headcount_plan` (squad_id, quarter_start, approved_seats)

Constraints: partial unique index on `seats(worker_id) WHERE worker_id IS NOT NULL`; check
constraints for enums and for "filled ⇔ worker_id not null"; foreign keys. A custom migration adds a
trigger that raises on `UPDATE` or `DELETE` of `app.seat_changes`. Write `docs/data-model.md` with
a Mermaid ER diagram and one line per table.
- [ ] `pnpm db:migrate` on an empty DB (no schemas) succeeds and creates `app`, `workday` and `analytics` (`CREATE SCHEMA IF NOT EXISTS` in the first migration, so Neon needs no manual setup); running it again is a no-op
- [ ] `pnpm test:db`: inserting a second seat for the same worker fails with a unique violation
- [ ] `pnpm test:db`: `UPDATE` and `DELETE` on `app.seat_changes` both raise
- [ ] `pnpm test:db`: an invalid status, and a `filled` seat with a null worker, are both rejected
- [ ] `workday.workers` has `position_id`, `cost_center` and `location` columns; `app.seats` has no position column (D-029)
- [ ] `docs/data-model.md` lists every table and column created by the migrations
Likely files: `db/schema/app.ts`, `db/schema/workday.ts`, `db/migrations/*`, `drizzle.config.ts`, `tests/db/constraints.test.ts`, `docs/data-model.md`.

### LR-01-07 · Deterministic seed generator (current state) · status: done (PR #5) · depends: LR-01-06 · owner: agent · executor model: sonnet
`pnpm db:seed` truncates and reseeds `app` and `workday` from a fixed faker seed (D-014): 4
divisions, 12 groups, about 180 squads, about 2,000 workers (~10% contingent), about 200
open/backfill seats, some `offer_accepted`, leaders for each division and group, and an approved headcount plan
per squad for the previous 2, current and next 2 quarters. Division, group and squad names come
from a hand-written fictional word list, not faker company names. The seed guarantees named demo
fixtures that tests and the demo script rely on, documented in `scripts/seed/README.md`: a demo
division leader and a demo group leader, an open seat outside the group leader's scope, a worker on
leave, and a terminated worker who still holds a seat. `pnpm db:seed:check` prints a checksum of
the seeded rows.

From the same generated data, the seed also writes two mock **Workday custom report** CSVs to
`data/workday/` (gitignored, regenerated deterministically): `worker_report_2026-11-01.csv` (matches
the seeded state) and `worker_report_2026-11-15.csv` (the next biweekly report: a handful of hires,
terminations including seated workers, manager changes, a leave). The reports use Workday-style
formats on purpose (`Last, First` names, `MM/DD/YYYY` dates, status text like `On Leave`, a
`Worker_Type` of `Employee` / `Contingent Worker`) so BR-03 has real cleaning to do. The report also
carries `Position_ID` (Workday-style, e.g. `P-004217`; one per worker, and a new hire in the 11-15
report gets a new one), `Cost_Center` (one per group, shown Workday-style as
`CC-1040 Platform Engineering`, using the fictional group name), and `Location` (a short fixed list
of office cities plus `Remote`; no company or building names). In this little
rock the seed writes `workday.workers` directly; LR-03-01 switches it to load through the ingest
script.

**Workday report realism (added 2026-11-12, Rob; applies before the LR-01-07 PR opens):**
1. **Report population.** Like a real filtered worker report, each report contains every `Active`
   and `On Leave` worker, plus `Terminated` workers whose termination date falls within the 30 days
   up to and including the report date. Workers terminated earlier than that are left out. The
   layout doc states this rule. The 11-15 report includes at least one worker who was `Terminated`
   in 11-01 and has now aged out (dropped legitimately), plus one `Active` worker from 11-01 who is
   missing with no termination (the real "missing" exception). The "terminated but still seated"
   fixture has a termination date inside the 11-15 window.
2. **Future-dated hires.** The 11-15 report includes 2–3 hires with a `Hire_Date` 1–60 days after
   the report date (status `Active`). Each one sits in a group that has a seeded `offer_accepted`
   seat. At least one group has more `offer_accepted` seats than future-dated hires, so the gap
   shows up. Future-dated hires hold no seat in `app.seats`.
3. **Supervisory org is not the squad.** `Supervisory_Organization` is shown Workday-style as
   `<org name> (<manager full name>)`, e.g. `Platform Engineering (Dana Lee)`. It follows the
   manager tree, not the app's squads. The layout doc says squads exist only in the app.
4. **Worker IDs and contract end dates.** One `Worker_ID` column with two ID schemes: employees are
   six digits (`104217`), contingent workers are `C-` plus five digits (`C-04512`).
   `Contract_End_Date` (`MM/DD/YYYY`) is filled for contingent workers and blank for employees. It
   lives in the CSV only: no `workday.workers` column yet, and staging parses it.
5. **Real CSV properties.** UTF-8 with a BOM; at least a few names with an apostrophe, an accented
   character, or a hyphen (e.g. `"O'Brien, Seán"`, `"Nguyen-Park, Zoë"`); every field containing a
   comma is quoted; CRLF line endings, like a typical export. Names still come from faker with the
   fixed seed. Pick a seeded locale mix or a small hand-written list of fictional names (given
   names and surnames) for the special characters.
- [ ] Running `pnpm db:seed` twice prints the same checksum (test)
- [ ] Invariants test: no double-seating, 1,900–2,100 workers, contingent share 8–12%, open+backfill seats 170–230, every seat's type matches its worker's type, every squad has at least one plan row per quarter
- [ ] Every named demo fixture exists (test looks each one up by its documented key)
- [ ] Both report CSVs are written, byte-identical across runs (hash test); the 11-15 report's differences from 11-01 match the documented change list in `scripts/seed/README.md`
- [ ] `scripts/seed/README.md` documents the worker report layout, modeled on a typical Workday worker custom report: one row per column with column name, format and example value, plus one full sample row. A test asserts that the generated CSV header matches the documented column list exactly, in order. Rob approves the layout during PR review. (Approved: Rob merged PR #5, D-032.)
- [ ] Plausibility test over the seeded workers: every manager has 3–15 direct reports; following `manager_worker_id` from any worker reaches the top without a cycle; every `hire_date` is on or before the report date, except the documented future-dated hires (1–60 days after); every `termination_date` is on or after its `hire_date`; only `terminated` workers have a `termination_date`; every worker has a non-empty `position_id`, `cost_center` and `location`; no two non-terminated workers share a `position_id`; every worker's `cost_center` is the one assigned to their seat's group (workers without a seat are exempt)
- [ ] Report realism test over both CSVs: the file starts with a UTF-8 BOM and uses CRLF; every terminated row's termination date is within 30 days of the report date; the documented aged-out and missing-without-termination workers behave as described; 2–3 future-dated hires appear in 11-15, each in a group with an `offer_accepted` seat; every `Supervisory_Organization` matches `^.+ \(.+\)$`; every `Worker_ID` matches `^\d{6}$` for employees and `^C-\d{5}$` for contingent workers; `Contract_End_Date` is set exactly for contingent rows; at least 3 names contain an apostrophe, accent or hyphen and round-trip through a CSV parser unchanged
- [ ] `git grep -niE "inc\.|llc|corp"` over `scripts/seed` finds no company-like names other than Second Republic Bank
- [ ] `git grep -ni "first republic"` matches only `docs/DECISIONS.md` (D-001) the `CLAUDE.md` rule, and this criterion's own line in this spec, never seed data, UI, fixtures or the README
Likely files: `scripts/seed/index.ts`, `scripts/seed/org.ts`, `scripts/seed/workers.ts`, `scripts/seed/seats.ts`, `scripts/seed/names.ts`, `scripts/seed/workday-reports.ts`, `scripts/seed/README.md`, `tests/db/seed.test.ts`, `package.json`.

### LR-01-08 · CI database job and Neon deploy workflow · status: todo · depends: LR-01-03, LR-01-07 · owner: agent · executor model: sonnet
Add a CI job with a Postgres 16 service container: migrate, seed, `pnpm test:db`, and run Playwright
against the seeded DB. Add `db-deploy.yml` (manual `workflow_dispatch` only): runs migrations and
the seed against the database in the `NEON_DATABASE_URL_UNPOOLED` secret, with an input
`reseed: true|false`. Extend `/api/health` to report the seat count.
- [ ] CI DB job passes on this PR (link the run)
- [x] `db-deploy.yml` passes `actionlint` (or the GitHub workflow validator) and never echoes the secret
- [x] `/api/health` returns the seeded seat count locally (test)
- [x] `pnpm db:seed` refuses a non-local database (host not `localhost`/`127.0.0.1`) unless `--allow-remote` is passed, and prints the target host (never the connection string); `db-deploy.yml` passes `--allow-remote`. Test covers the refusal. (Added by orchestrator from the LR-01-07 review: after `vercel env pull`, a bare `pnpm db:seed` would truncate Neon.)
- [x] `db-deploy.yml` installs with plain `pnpm install --frozen-lockfile` (the seed needs dev dependency `@faker-js/faker`; no `--prod`)
Likely files: `.github/workflows/ci.yml`, `.github/workflows/db-deploy.yml`, `src/app/api/health/route.ts`, `tests/db/health.test.ts`.

### LR-01-09 · GitHub secrets and first Neon seed · status: todo · depends: LR-01-05, LR-01-08 · owner: rob · executor model: —
Add `NEON_DATABASE_URL_UNPOOLED` as a GitHub Actions secret (copy from Vercel → Storage → Neon).
Also add the `DBT_HOST`, `DBT_USER`, `DBT_PASSWORD`, `DBT_DBNAME` secrets now (same Neon database;
LR-03-05 uses them), so there's only one trip to the settings page. Run `db-deploy` with `reseed: true`.
- [ ] The `db-deploy` run is green
- [ ] Production `/api/health` shows the same seat count as local
