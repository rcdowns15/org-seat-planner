# BR-01 — Foundations

**Status:** todo · **Depends on:** — · **Milestone:** M1 · **Target:** Thu 2026-11-12 · **Cut line:** yes

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
- Docker Desktop must be running for `pnpm test:db`; it isn't installed yet (LR-01-10).

## Exit criteria
- Every command under "Checks" in `CLAUDE.md` that exists passes locally and in CI on `main`.
- The deployed Vercel URL's `/api/health` returns `200` with `db: "ok"` and the seeded seat count.
- `pnpm db:seed` twice gives the same checksum; the seed invariants test passes.
- `docs/data-model.md` has an ER diagram matching the migrations.

## Little rocks
Parallel: LR-01-03 and LR-01-04 can run together after LR-01-02. LR-01-05 (Rob) can happen as soon
as LR-01-04 is merged, while LR-01-06 runs.

### LR-01-10 · Machine setup (tonight, before any executor runs) · status: todo · depends: — · owner: rob · executor model: —
Checked 2026-11-11: Docker missing, `LongPathsEnabled = 0`, pnpm missing; Node 24, WSL and `gh` present.
1. Admin PowerShell: `New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`
2. Install Docker Desktop for Windows (WSL 2 backend), then restart once (this also applies the long-paths change).
3. `corepack enable` (provides pnpm; LR-01-02 pins the exact version in `packageManager`).
- [ ] `docker run --rm hello-world` succeeds
- [ ] `(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem").LongPathsEnabled` returns `1`
- [ ] `pnpm --version` prints a version

### LR-01-01 · Create the GitHub repo · status: todo · depends: — · owner: rob · executor model: —
Create a public GitHub repo named `org-seat-planner` (local folder stays `hr-app`), add it as `origin`,
push `main`. Turn on branch protection for `main`: require a PR (and, once LR-01-03 merges, require
the CI check).
- [ ] `gh repo view --json visibility,name` shows `PUBLIC`
- [ ] `git push` to `main` directly is rejected; a PR is required
- [ ] Repo description mentions "fictional company, mock data"
Likely files: none (GitHub settings).

### LR-01-02 · Next.js TypeScript scaffold and tooling · status: todo · depends: LR-01-01, LR-01-10 · owner: agent · executor model: sonnet
Scaffold Next.js (current stable, App Router, `src/` dir) in TypeScript strict mode at the repo root
with pnpm, Tailwind and shadcn/ui (init plus `button`, `card`, `dialog`, `select`, `badge`). Add
ESLint + Prettier, Vitest, and Playwright. Add the scripts named in "Commands" and "Checks"
(`lint`, `typecheck`, `test`, `test:e2e`, `build`; DB scripts can be stubs that print "added in
LR-01-04/06"). Pin Node in `.nvmrc` and pnpm in `packageManager`. The home page shows "Org Seat
Planner · Northwind Financial (fictional)". Update `.gitignore` if needed.
- [ ] `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] `pnpm test` runs at least one real unit test (e.g. a `formatSeatStatus` helper), not just a placeholder `expect(true)`
- [ ] `pnpm test:e2e` starts the app and asserts the home page heading text
- [ ] `tsconfig.json` has `"strict": true`; `.nvmrc` and `packageManager` are set
Likely files: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.prettierrc`, `vitest.config.ts`, `playwright.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/ui/*`, `tests/unit/*`, `tests/e2e/home.spec.ts`, `.nvmrc`.

### LR-01-03 · CI workflow · status: todo · depends: LR-01-02 · owner: agent · executor model: sonnet
GitHub Actions `ci.yml` on `pull_request` and pushes to `main`: install with the pinned pnpm and
Node (cache the pnpm store), then `lint`, `typecheck`, `test`, `build`, and a Playwright job
(install Chromium only).
- [ ] The workflow runs on the PR for this little rock and passes (link the run in the PR)
- [ ] A deliberately failing lint check on a scratch commit fails CI (show the run, then revert)
- [ ] Node and pnpm versions come from `.nvmrc` / `packageManager`, not hardcoded in the workflow
Likely files: `.github/workflows/ci.yml`.

### LR-01-04 · Local Postgres, DB client, health route · status: todo · depends: LR-01-02 · owner: agent · executor model: sonnet
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

### LR-01-05 · Link Vercel and Neon · status: todo · depends: LR-01-04 · owner: rob · executor model: —
Import the GitHub repo into Vercel. Add Neon through the Vercel Marketplace integration (creates
`DATABASE_URL` and `DATABASE_URL_UNPOOLED`). Create the `app`, `workday` and `analytics` schemas on
Neon (paste `db/init/01-schemas.sql` into the Neon SQL editor). Set `DEMO_MODE=true` in Vercel.
- [ ] The production URL's `/api/health` returns `200` with `"db":"ok"`
- [ ] Production URL recorded in `docs/PROGRESS.md` and the README
- [ ] No connection string committed anywhere (`git grep -n "neon.tech"` returns nothing)
Likely files: `docs/PROGRESS.md`, `README.md`.

### LR-01-06 · Drizzle schema and migrations for `app` and `workday` · status: todo · depends: LR-01-04 · owner: agent · executor model: opus
Define the data model in Drizzle and generate migrations (see D-010 and the "Domain edge cases" in
`CLAUDE.md`):
- `workday.workers`: the typed, current view of Workday (worker_id, names, email, worker_type
  `employee|contingent`, status `active|leave|terminated`, hire_date, termination_date,
  manager_worker_id, job_title, supervisory_org, as_of_report_date, updated_at). BR-03 adds the raw
  report landing tables.
- `app.divisions`, `app.groups`, `app.squads` (explicit three-level hierarchy)
- `app.leaders` (leader_id, worker_id, display name, scope_type `division|group`, scope_id)
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
- [ ] `pnpm db:migrate` on an empty DB succeeds; running it again is a no-op
- [ ] `pnpm test:db`: inserting a second seat for the same worker fails with a unique violation
- [ ] `pnpm test:db`: `UPDATE` and `DELETE` on `app.seat_changes` both raise
- [ ] `pnpm test:db`: an invalid status, and a `filled` seat with a null worker, are both rejected
- [ ] `docs/data-model.md` lists every table and column created by the migrations
Likely files: `db/schema/app.ts`, `db/schema/workday.ts`, `db/migrations/*`, `drizzle.config.ts`, `tests/db/constraints.test.ts`, `docs/data-model.md`.

### LR-01-07 · Deterministic seed generator (current state) · status: todo · depends: LR-01-06 · owner: agent · executor model: sonnet
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
`Worker_Type` of `Employee` / `Contingent Worker`) so BR-03 has real cleaning to do. In this little
rock the seed writes `workday.workers` directly; LR-03-01 switches it to load through the ingest
script.
- [ ] Running `pnpm db:seed` twice prints the same checksum (test)
- [ ] Invariants test: no double-seating, 1,900–2,100 workers, contingent share 8–12%, open+backfill seats 170–230, every seat's type matches its worker's type, every squad has at least one plan row per quarter
- [ ] Every named demo fixture exists (test looks each one up by its documented key)
- [ ] Both report CSVs are written, byte-identical across runs (hash test); the 11-15 report's differences from 11-01 match the documented change list in `scripts/seed/README.md`
- [ ] `git grep -niE "inc\.|llc|corp"` over `scripts/seed` finds no company-like names other than Northwind Financial
Likely files: `scripts/seed/index.ts`, `scripts/seed/org.ts`, `scripts/seed/workers.ts`, `scripts/seed/seats.ts`, `scripts/seed/names.ts`, `scripts/seed/workday-reports.ts`, `scripts/seed/README.md`, `tests/db/seed.test.ts`, `package.json`.

### LR-01-08 · CI database job and Neon deploy workflow · status: todo · depends: LR-01-03, LR-01-07 · owner: agent · executor model: sonnet
Add a CI job with a Postgres 16 service container: migrate, seed, `pnpm test:db`, and run Playwright
against the seeded DB. Add `db-deploy.yml` (manual `workflow_dispatch` only): runs migrations and
the seed against the database in the `NEON_DATABASE_URL_UNPOOLED` secret, with an input
`reseed: true|false`. Extend `/api/health` to report the seat count.
- [ ] CI DB job passes on this PR (link the run)
- [ ] `db-deploy.yml` passes `actionlint` (or the GitHub workflow validator) and never echoes the secret
- [ ] `/api/health` returns the seeded seat count locally (test)
Likely files: `.github/workflows/ci.yml`, `.github/workflows/db-deploy.yml`, `src/app/api/health/route.ts`, `tests/db/health.test.ts`.

### LR-01-09 · GitHub secrets and first Neon seed · status: todo · depends: LR-01-05, LR-01-08 · owner: rob · executor model: —
Add `NEON_DATABASE_URL_UNPOOLED` as a GitHub Actions secret (copy from Vercel → Storage → Neon).
Also add the `DBT_HOST`, `DBT_USER`, `DBT_PASSWORD`, `DBT_DBNAME` secrets now (same Neon database;
LR-03-05 uses them), so there's only one trip to the settings page. Run `db-deploy` with `reseed: true`.
- [ ] The `db-deploy` run is green
- [ ] Production `/api/health` shows the same seat count as local
