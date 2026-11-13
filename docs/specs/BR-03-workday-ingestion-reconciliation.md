# BR-03 — Workday ingestion and reconciliation (thin pipeline slice)

**Status:** in-progress · **Depends on:** BR-01 (can run in parallel with BR-02) · **Milestone:** M3 · **Target:** Fri 11/13 – Sat 11/14 · **Cut line:** yes

## Goal
A biweekly mock Workday custom report (CSV) is validated and ingested into a raw landing table and a
typed current table. dbt cleans it, then compares HRIS facts with the leaders' seat plan to produce
three outputs: squad headcount vs. the approved plan, what changed since the last report, and
reconciliation exceptions. One command, `pnpm pipeline`, runs ingest → dbt build. The design lets a
real Workday RaaS/API pull replace the CSV reader without changing anything downstream.

## Why it matters
People-data work is mostly this: take a messy HRIS extract, clean it repeatably, reconcile it with
the plan, and drive the gaps to zero. Paired with BR-02, the demo covers both halves of the job:
leaders edit the plan, and the pipeline checks the plan against the HRIS.

## Scope
In: report ingestion with file-level validation, raw + current tables, ingest run log, dbt project
(sources, staging, two dims, three reports), grain and custom tests, `pnpm pipeline`, CI dbt job,
manual dbt-on-Neon workflow, SQL panel presets for the marts.
Out: 18 months of history, snapshots and daily facts (BR-05), semantic layer (BR-06), live API
client, other sources (TA, FP&A) and an exceptions UI (BR-07), dashboard (BR-08).

## Key risks / open questions
- Keep it small: three marts plus two dims. Resist adding more models before the interview.
- "Terminated worker still seated" is supposed to show up as an exception: that's the demo. It's a
  report row, not a failing test. An error-level test checks the report catches every seeded case.

## Exit criteria
- `pnpm pipeline` on a fresh local DB ingests the 11-01 report, then the 11-15 report, and
  `dbt build` passes, all from a single command.
- After the 11-15 report, `rpt_reconciliation_exceptions` lists exactly the seeded exceptions, and
  `rpt_workday_changes` lists exactly the documented changes.
- The dbt CI job is green; the manual dbt-on-Neon workflow is green; the SQL panel shows both marts on production.

## Little rocks
Parallel: LR-03-01 and LR-03-02 overlap once LR-03-01's migration is committed (LR-03-02 stacks on it; see its dependency note). LR-03-03 needs LR-03-02 and LR-03-04
needs LR-03-01 and LR-03-03.

### LR-03-01 · Workday report ingestion with validation · status: done (https://github.com/rcdowns15/org-seat-planner/pull/9) · depends: LR-01-07 · owner: agent · executor model: sonnet
`pnpm workday:ingest <file>` (code in `scripts/ingest/`, written as a reader interface with a CSV
implementation, so an API reader can replace it later). Steps:
1. Validate the whole file before loading anything: strip a leading UTF-8 BOM and accept CRLF;
   required columns present, `Worker_ID` unique and non-empty, dates parse (blank
   `Contract_End_Date` allowed), status and worker-type values in the known set, `Worker_ID`
   format agrees with `Worker_Type` (six digits for `Employee`, `C-` plus five digits for
   `Contingent Worker`), the report date taken from the file name. Future-dated `Hire_Date`s are
   valid; termination dates after the report date are not. Any failure rejects the whole file with a readable report and loads nothing.
2. Load every row as text into `workday.raw_worker_report` (plus `report_date`, `source_file`,
   `file_sha256`, `loaded_at`). Loading the same file twice is a no-op (by hash).
3. Upsert the typed `workday.workers` current table from the report.
4. Record the run in `workday.ingest_runs` (file, hash, row count, status, rejection reasons).

Switch `pnpm db:seed` to load Workday through this script.

Rules approved by Rob (2026-11-12, from the LR-03-01 build): (a) a report whose date isn't newer than the latest loaded report is rejected (an identical re-run is still `skipped`); (b) `workday.workers` is upsert-only: a worker missing from a later report keeps their row with the older `as_of_report_date`, which is how the missing-worker exception surfaces; (c) `Worker_Name` (as `Last, First`), `Work_Email`, `Job_Title`, `Supervisory_Organization`, `Position_ID`, `Cost_Center` and `Location` must be non-blank.
- [ ] DB test: ingesting 11-01 then 11-15 gives the expected row counts in raw (both reports) and current tables
- [ ] DB test: re-ingesting the same file changes nothing and records a `skipped` run
- [ ] Unit tests: a file with a duplicate ID, a missing column, a bad date, an unknown status, or a `Worker_ID` whose format contradicts its `Worker_Type` is rejected with a message naming the row and column; nothing is loaded
- [ ] Unit test: a BOM-prefixed, CRLF file with quoted `"O'Brien, Seán"`-style names parses, and the names come through byte-for-byte
- [ ] The ingest CSV parsing doesn't reuse the seed's CSV writer or parser code, so a quoting bug in the seed can't hide behind a matching bug in ingest (from the LR-01-07 review)
- [ ] Seed checksum from LR-01-07 is unchanged after the switch: first commit pins `8cb477f9fde138983f8740eb86a026f5e77f39c229bae64a4dafab10f79af340` as a constant asserted in `tests/db/seed.test.ts` (and in `scripts/seed/README.md`), so the after-switch run is checked against a recorded baseline (BR-01 review P2-2)
Likely files: `scripts/ingest/index.ts`, `scripts/ingest/csv-reader.ts`, `scripts/ingest/validate.ts`, `db/schema/workday.ts`, `db/migrations/*`, `scripts/seed/index.ts`, `tests/unit/ingest-validate.test.ts`, `tests/db/ingest.test.ts`, `tests/fixtures/workday/*.csv`.

### LR-03-02 · dbt project, sources and staging · status: done (PR #10 merged) · depends: LR-01-08, LR-03-01 (migration only) · owner: agent · executor model: sonnet
Dependency note (navigator, 2026-11-12): `workday.raw_worker_report` and `workday.ingest_runs` don't
exist until LR-03-01's migration, so this little rock's sources can't build before then. It branches
from LR-03-01's branch once that migration is committed, and its PR merges after LR-03-01's (stacked).
`analytics/` as a uv project (`pyproject.toml`, `uv.lock`, `.python-version`) with dbt-core and
dbt-postgres pinned. `profiles.yml` reads `DBT_*` env vars. Custom schema naming (`analytics_staging`,
`analytics_intermediate`, `analytics`). Sources for `workday.raw_worker_report`,
`workday.ingest_runs` and the `app` tables, with key tests. Staging: `stg_workday__worker_report`
does the Workday report transforms (split `Last, First`, parse `MM/DD/YYYY` including
`Contract_End_Date`, map status and worker type text to enums, trim and normalize IDs, split
`Supervisory_Organization` into org name and manager name, and add `is_future_hire` when
`hire_date` > report date), one `stg_app__*` model per app table. CI job: Postgres
service → migrate → seed → `uv run dbt build`.
- [ ] `cd analytics && uv run dbt build` passes locally and in CI
- [ ] Every staging model has a description and key tests; every enum has `accepted_values`
- [ ] A singular test proves the cleaning: every raw row maps to exactly one staged row, with no null status or type
- [ ] No credentials in `profiles.yml` (env vars only)
Likely files: `analytics/pyproject.toml`, `analytics/uv.lock`, `analytics/.python-version`, `analytics/dbt_project.yml`, `analytics/profiles.yml`, `analytics/macros/generate_schema_name.sql`, `analytics/models/staging/**`, `.github/workflows/ci.yml`.

### LR-03-03 · Dimensions, squad headcount vs. plan, and custom tests · status: in-progress · depends: LR-03-02 · owner: agent · executor model: sonnet
`dim_squads` (squad with group and division), `dim_people` (latest report per worker plus current
seat). `rpt_squad_headcount` (grain: squad × report date): filled employee seats, filled contingent
seats, open, backfill, offer accepted, approved plan for that quarter, variance, fill rate. Custom
tests: `no_double_seating` (error), `squad_not_over_plan` (error: filled + offer accepted ≤ approved).
- [ ] Grain tests on all three models (`unique` / `not_null`, or `unique_combination_of_columns`)
- [ ] Seat counts are rebuilt as of each report date from `app.seat_changes` (D-036): start from live `app.seats` and rewind every change with `effective_date` > report date using its `from_*` columns (`int_seat_state_as_of`). Changes are ordered by `(effective_date, change_id)`.
- [ ] Singular test: latest-report totals in `rpt_squad_headcount` equal live `app.seats` counts when no seat change is effective after the report date (restated by D-036; coalesce squads with no seats to 0)
- [ ] dbt `unit_tests:` for the seat-state/occupancy model: a same-day double hop, a move pair, a seat that never changed, a planted overlap (the seed has 0 `seat_changes`, so the seed alone proves nothing)
- [ ] dbt unit test: a worker missing from a later report stays in `dim_people` with `is_in_latest_report = false`
- [ ] Warn-level test: no seat change has an `effective_date` earlier than an earlier-saved change on the same worker or seat (backstop for LR-02-10, D-037)
- [ ] Each custom test fails on a hand-made bad row (show the failing run in the PR) and passes on the seed
Likely files: `analytics/models/intermediate/**`, `analytics/models/marts/dim_squads.sql`, `analytics/models/marts/dim_people.sql`, `analytics/models/marts/rpt_squad_headcount.sql`, `analytics/models/marts/_marts.yml`, `analytics/tests/**`.
**Decided 2026-11-13 (Rob):** P1 → option 1 (D-036). P2 ordering → the move service rejects backwards effective dates in new LR-02-10 (D-037); this model orders by `(effective_date, change_id)` and adds the warn-level test. The criteria above are updated; fix the remaining P2s and P3s in fix round 1.
**Review 1 (2026-11-12, orchestrator; branch `lr/LR-03-03-marts` @ cdaf6bf): changes required.**
- **P1:** `rpt_squad_headcount` stamps today's live `app.seats` counts on every report date. The stated premise, "no seat history", is false: `app.seat_changes` has `from_*`/`to_*`/`effective_date`.
  - Historical rows are wrong.
  - The latest row counts future-dated moves.
  - `squad_not_over_plan` can falsely fail across a quarter boundary.
  - Option 1 (orchestrator recommends): rebuild seat state as of each report date from `seat_changes` (`int_seat_state_as_of`). Restate criterion 2 as "latest-report totals equal live `app.seats` counts when no seat change is effective after the report date".
  - Option 2: Rob approves the live-count shortcut in DECISIONS. Correct the wording and limit `squad_not_over_plan` to `is_latest_report`.
- **P2 (needs a domain rule):** `int_seat_occupancy` orders by `effective_date`, but the app applies changes in save order. A later-saved move with an earlier effective date (allowed by LR-02-03) makes `no_double_seating` fail on legitimate use.
  - Decide: either the move service rejects an effective date earlier than the worker's or seat's latest pending change (a new BR-02 little rock), or the model orders by `created_at`.
  - Either way, add a warn-level test for backwards effective dates.
- **P2:** add dbt `unit_tests:` for `int_seat_occupancy`: a same-day double hop, a move pair, a seat that never changed, a planted overlap. The seed has 0 `seat_changes`, so `no_double_seating` proves nothing on it.
- **P2:** add a dbt unit test showing a worker missing from a later report stays in `int_worker_latest_report`/`dim_people` with `is_in_latest_report = false`.
- **P3s:**
  - The live-seats test gives a false failure for a squad with no seats (coalesce `live` to 0).
  - The `dim_people` description should say seated workers never seen in a report are absent.
  - The `is_latest_report` wording overstates what it means.

### LR-03-04 · Refresh changes and reconciliation exceptions · status: todo · depends: LR-03-01, LR-03-03 · owner: agent · executor model: opus
`rpt_workday_changes` (grain: worker × report date): what changed between consecutive reports
(hire, future-dated hire, termination, manager change, worker-type change, leave start/end, and
`aged_out`: a terminated worker who drops off under the report's 30-day termination window, which is
not an exception). The window is the one the seed uses: inclusive, from report date minus 29 days
through the report date. `rpt_reconciliation_exceptions` (grain: exception type × subject, where the
subject is a worker, or a group for the hiring check), comparing the latest report with the seat
plan: terminated in Workday but still seated; seated but missing from the report (always an
exception, even if they aged out); in the previous report as `Active`/`On Leave` but missing now
with no termination; worker type doesn't match seat type; on leave and seated (info severity);
**hiring gap**: a group's `offer_accepted` seats outnumber its future-dated Workday hires (info
severity, matched at group level through `Cost_Center` because seats aren't linked to positions,
D-029). Each row has a severity and a suggested action.
- [ ] After both reports: `rpt_workday_changes` matches the change list documented in `scripts/seed/README.md` exactly (singular test)
- [ ] `rpt_reconciliation_exceptions` contains each seeded exception exactly once (singular test), and nothing else on the seed
- [ ] Error-level test: every seated worker whose latest status is `terminated` appears in the exceptions report
- [ ] Singular test: the documented aged-out worker appears in `rpt_workday_changes` as `aged_out` and **not** in the exceptions; the documented missing-without-termination worker **does** appear
- [ ] Every model has a description; grain tests on both reports
Likely files: `analytics/models/intermediate/int_worker_report_versions.sql`, `analytics/models/marts/rpt_workday_changes.sql`, `analytics/models/marts/rpt_reconciliation_exceptions.sql`, `analytics/models/marts/_marts.yml`, `analytics/tests/**`.

### LR-03-05 · `pnpm pipeline`, dbt on Neon, SQL panel presets · status: todo · depends: LR-03-04, LR-02-08, LR-01-09 · owner: agent · executor model: sonnet
`pnpm pipeline [--report <file>]`: ingest the given (or latest) report → `uv run dbt build`, stopping
at the first failure and printing a summary (rows ingested, models built, tests passed, exception
counts by type). `pipeline.yml` (manual `workflow_dispatch`) runs the same against Neon with the
`DBT_*` and `NEON_DATABASE_URL_UNPOOLED` secrets. Add three read-only presets to the SQL panel:
reconciliation exceptions, latest Workday changes, squad headcount vs. plan (with a friendly message
if `analytics` is empty). Write `docs/orchestration.md`: each pipeline step mapped to the Airflow
task it would be in production (sensor on the report, ingest, dbt build, alert on exceptions).
- [ ] `pnpm pipeline` on a freshly seeded DB runs both reports and prints the summary; a failing dbt test makes it exit non-zero (test)
- [ ] A `pipeline.yml` run against Neon is green (link it)
- [ ] e2e: the SQL panel's reconciliation preset shows the seeded exceptions
Likely files: `scripts/pipeline.ts`, `.github/workflows/pipeline.yml`, `src/server/queries/under-the-hood.ts`, `src/components/sql-panel.tsx`, `docs/orchestration.md`, `package.json`, `tests/e2e/sql-panel.spec.ts`.

### LR-03-06 · Stop a position backfill from wedging ingestion · status: done (https://github.com/rcdowns15/org-seat-planner/pull/12) · depends: LR-03-01, LR-03-02 (touches `analytics/` tests; dispatch after #10 merges) · owner: agent · executor model: sonnet · cut line: yes (D-034)
From the LR-03-01 round-2 review (P2, waived in that PR). `workday.workers` is upsert-only (approved), and the partial unique
index `workers_position_id_active_key` (migration 0001, D-029) allows one non-terminated holder per `Position_ID`. If worker A
drops out of the extract while still non-terminated and B is backfilled into A's position, every later report fails that
index and is recorded `rejected` until someone edits the table by hand. That contradicts "a missing worker is an exception, not
a blocker". The seed never triggers it. Decided in D-034 (amends D-029): fix before the interview.
- [ ] New migration drops or relaxes the index (e.g. scoped to the latest report); merged migrations stay untouched
- [ ] DB test: the backfill scenario ingests successfully, and the missing worker still surfaces as an exception input
- [ ] "One current holder per position" is enforced on the latest report as a dbt test or reconciliation exception
Likely files: `db/schema/workday.ts`, `db/migrations/*`, `tests/db/ingest.test.ts`, `analytics/` tests, `docs/data-model.md`.
