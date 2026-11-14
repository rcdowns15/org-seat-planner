# Pipeline: how a Workday report becomes reconciliation exceptions

This explainer walks through the data path of the seat planner: a biweekly Workday worker report
(a CSV) is validated and loaded into the `workday` schema, dbt cleans it, rebuilds seat history
from the app's audit log, and compares the two in a reconciliation mart. Code is cited as
`path:line`; `pnpm docs:check` fails CI if a cited file or line stops existing, so the numbers stay
honest. (They can still drift to a nearby line if code is inserted above them; when in doubt, open
the file.) The write path (moves, locking, audit) has its own explainer:
[write-back.md](write-back.md).

## Read these first

Read them in this order. If you can explain these eight spots, you can explain the pipeline.

1. `scripts/ingest/load.ts:132`: `ingestReport`, the whole ingest contract in one function:
   validate first, then one transaction that locks, skips a file it has already loaded, refuses an
   older report, and loads.
2. `scripts/ingest/validate.ts:74`: `validateReport`, which checks every row of the file and
   collects every problem before anything touches the database (D-028).
3. `scripts/ingest/load.ts:60`: `loadReport`, the two writes: raw rows exactly as the file had
   them, then an upsert (never a delete) into the typed current table.
4. `analytics/models/staging/workday/stg_workday__worker_report.sql:13`: the `cleaned` CTE, where
   every messy Workday format is turned into clean columns, in SQL, one row in for one row out.
5. `analytics/models/intermediate/int_seat_state_as_of.sql:31`: `earliest_later_change`, the trick
   that rebuilds every seat's state as of each report date from the audit log (D-036).
6. `analytics/models/marts/rpt_reconciliation_exceptions.sql:19`: the `seated` CTE, the join of the
   leaders' plan to the latest Workday facts that most exception rules read.
7. `analytics/models/marts/rpt_reconciliation_exceptions.sql:158`: `hiring_gap`, the check that
   tells the hiring story without a Talent Acquisition feed (D-031, D-033).
8. `scripts/pipeline.ts:98`: the pipeline as a list of steps (one ingest per report, then
   `dbt build`), which is the shape an Airflow DAG would take (D-020).

## 0. The map

```
data/workday/worker_report_YYYY-MM-DD.csv     (written by the seed, or `pnpm workday:reports`)
        |  scripts/ingest: read -> parse -> validate whole file -> one transaction
        v
workday.raw_worker_report   every row of every accepted report, all text, untouched
workday.workers             typed current view, one row per worker ever seen (upsert only)
workday.ingest_runs         one row per attempt: loaded / skipped / rejected
        |  dbt (analytics/)
        v
analytics_staging           stg_workday__worker_report (cleaning), stg_app__* (renames)
analytics_intermediate      latest row per worker, report-to-report pairs, seat state as of each report date
analytics                   dim_squads, dim_people, rpt_squad_headcount, rpt_workday_changes,
                            rpt_reconciliation_exceptions
        |
        v
SQL panel presets on /sql (read-only SELECTs), the pipeline summary
```

The app writes `app` (seats and the audit log). Only `scripts/ingest/` and `scripts/seed/` write
`workday` (D-015). dbt only reads `app` and `workday` and writes its own schemas. The schema names
come straight from `analytics/dbt_project.yml` because the custom macro at
`analytics/macros/generate_schema_name.sql:6` uses them as-is, instead of dbt's default of
prefixing them with the target schema.

## 1. The ingest contract

**The rule (D-028):** validate the whole file, then load it in one transaction, or load nothing.
Raw rows are kept unchanged, and loading the same file twice is a no-op, decided by the file's hash.

### Step by step

1. **Read.** `pnpm workday:ingest <file>` (`scripts/ingest/index.ts:30`) hands a `CsvFileReader`
   to `ingestReport`. The reader (`scripts/ingest/reader.ts:20`) hashes the raw bytes with SHA-256
   first (`scripts/ingest/reader.ts:25`), so the hash identifies the exact file, before any
   decoding. Then it decodes UTF-8 with `fatal: true` (`scripts/ingest/reader.ts:31`): a file that
   isn't valid UTF-8 becomes a parse error, not silent replacement characters.
2. **Parse.** `parseReportCsv` (`scripts/ingest/parse-csv.ts:61`) handles RFC 4180 quoting, a
   leading byte-order mark, and CRLF or LF line endings. It returns cell text unchanged; no
   trimming happens here. It is written separately from the seed's CSV writer on purpose
   (`scripts/ingest/parse-csv.ts:1`), so a quoting bug in one can't hide behind the same bug in
   the other.
3. **Validate, before any database work.** `ingestReport` calls `validateReport` before it opens a
   transaction (`scripts/ingest/load.ts:137`). Validation is a pure function with no database. It
   checks:
   - the file name carries a real report date (`scripts/ingest/validate.ts:39`), which becomes the
     report's `report_date`;
   - the header has every expected column, no unknown or duplicate ones, in any order; a bad header
     stops before the rows, because cells can't be read by name (`scripts/ingest/validate.ts:102`);
   - each row: the right field count, a non-empty and unique `Worker_ID`
     (`scripts/ingest/validate.ts:123`), an ID format that matches the worker type (six digits for
     an employee, `C-` plus five digits for a contingent worker, `scripts/ingest/validate.ts:132`),
     a known status and type, required text present, a `Last, First` name, real `MM/DD/YYYY`
     dates (`scripts/ingest/validate.ts:42`), and no termination date after the report date
     (`scripts/ingest/validate.ts:167`);
   - one non-terminated holder per `Position_ID` within the file
     (`scripts/ingest/validate.ts:110`). The database no longer enforces this (D-034), so the
     validator gives a readable message instead.

   Every problem is collected, not just the first, and each message names the row and column. Only
   if the list is empty does it return the rows (`scripts/ingest/validate.ts:173`).
4. **One transaction.** Everything from here runs in `db.transaction`
   (`scripts/ingest/load.ts:157`):
   - **A lock.** `pg_advisory_xact_lock` on one fixed key (`scripts/ingest/load.ts:160`), so two
     ingests run one at a time. Without it, two different files could both pass the "newer report"
     check below at the same moment.
   - **Rejected file:** record a `rejected` run with the reasons and stop
     (`scripts/ingest/load.ts:172`). Nothing is loaded.
   - **Same file again:** if a `loaded` run already has this hash, record `skipped` and stop
     (`scripts/ingest/load.ts:176`). This is the idempotency rule.
   - **Older or same-dated report:** if the newest loaded report is on or after this one's date,
     reject it (`scripts/ingest/load.ts:185`). An older extract must not overwrite newer facts in the
     current table, and the previous report stays current.
   - **Load** (`scripts/ingest/load.ts:197`), then record a `loaded` run.
5. **A database error during the load** (a constraint the validator didn't anticipate) rolls the
   whole transaction back. The catch at `scripts/ingest/load.ts:200` turns a real Postgres error
   (one with a five-character SQLSTATE) into a `rejected` run, recorded in a fresh transaction
   (`scripts/ingest/load.ts:217`), because the first one, and its run row, are gone. Anything else
   (a bug, a lost connection) is rethrown.

### Raw vs. current

`loadReport` (`scripts/ingest/load.ts:60`) writes two tables in that one transaction:

| Table | What it holds | How it's written | Why |
|---|---|---|---|
| `workday.raw_worker_report` (`db/schema/workday.ts:63`) | Every row of every accepted report, all text, exactly as the file had it (padded names, `MM/DD/YYYY`, `On Leave`), plus `report_date`, `source_file`, `file_sha256`, `source_row` | Plain inserts, in batches of 1,000 (`scripts/ingest/load.ts:86`) | History and audit: you can always say what Workday sent on a given date, and re-clean it if the cleaning was wrong. dbt staging reads this. |
| `workday.workers` (`db/schema/workday.ts:28`) | One typed row per worker ever seen: trimmed text, ISO dates, enum values, `as_of_report_date` | Upsert on `worker_id`, never delete (`scripts/ingest/load.ts:90`) | The "what does Workday say now" view the app reads (worker status for the move checks). A worker missing from the newest report keeps their row with an older `as_of_report_date` (`scripts/ingest/load.ts:88`): a missing worker is an exception, not a deletion. |
| `workday.ingest_runs` (`db/schema/workday.ts:96`) | One row per attempt with status, row count, hash and rejection reasons | Insert per attempt | Operational audit: what was tried, what happened, and why a file was refused. |

The typed current row is built by `toWorker` (`scripts/ingest/load.ts:38`), the one place the
loader interprets values. That is a second implementation of the same cleaning dbt staging does,
so a dbt test ties them together: `assert_latest_report_staging_matches_workers`
(`analytics/tests/assert_latest_report_staging_matches_workers.sql:8`) requires
`workday.workers` to equal the latest report's staged rows, column by column. If the TypeScript and
the SQL ever clean a value differently, `dbt build` fails.

A unique index on `(file_sha256, source_row)` (`db/schema/workday.ts:89`) is the database's
backstop against loading the same file's rows twice, under the hash check.

### Idempotency by file hash

- The hash is of the bytes, so the same file always skips, whatever its name or path.
- A changed file (even one re-saved with different line endings) is a new hash. It doesn't skip,
  but it can't overwrite anything either: it carries the same report date, so the "not newer" rule
  rejects it.
- The seed loads the 11-01 report through this same `ingestReport` (`scripts/seed/run-seed.ts:46`),
  and `pnpm workday:reports` (`scripts/write-reports.ts:9`) writes byte-identical CSVs without
  touching a database. That's why the pipeline workflow can re-run against Neon safely: the 11-01
  file skips, and 11-15 loads once, then skips forever after.

### Ingest tests

| Behavior | Test |
|---|---|
| Both reports load; raw keeps both in full; current is the union, missing worker kept with an older date | `tests/db/ingest.test.ts`: "loads 11-01 then 11-15 with the expected raw and current counts" |
| Raw keeps padded text and `MM/DD/YYYY`; current is trimmed and typed | `tests/db/ingest.test.ts`: "keeps raw rows as the file had them, and types the current table" |
| Same file twice is a `skipped` no-op | `tests/db/ingest.test.ts`: "re-ingesting the same file changes nothing and records a skipped run" |
| A bad file loads nothing and the previous report stays current | `tests/db/ingest.test.ts`: "rejects a bad file, loads nothing and leaves the previous report current" |
| An older report is refused | `tests/db/ingest.test.ts`: "rejects a report that is not newer than the loaded one" |
| A position backfill after a worker drops out doesn't wedge ingestion (D-034) | `tests/db/ingest.test.ts`: "ingests, and the dropped worker stays a non-terminated row with an older report date" |
| A database refusal becomes a recorded rejection | `tests/db/ingest.test.ts`: "is recorded as a rejected run, loads nothing and leaves workers unchanged" |
| Each validation rule, and every problem collected | `tests/unit/ingest-validate.test.ts`, describe "validateReport rejects the whole file, naming row and column" (10 tests, including "collects every problem, not just the first") |
| Invalid UTF-8 and the BOM | `tests/unit/ingest-reader.test.ts`: "turns invalid UTF-8 into a parse error instead of replacement characters"; "reads a BOM-prefixed UTF-8 file" |

## 2. dbt staging: each Workday transform

`stg_workday__worker_report` is one row per raw row, every report, every worker. Its header comment
states the staging contract (`analytics/models/staging/workday/stg_workday__worker_report.sql:1`):
rename, cast, trim, map text to enums; no joins and no history logic. A value that fails to map
becomes `NULL` on purpose, so a `not_null` or `accepted_values` test catches it instead of a bad
value flowing downstream.

The workhorse is the `clean_text` macro (`analytics/macros/clean_text.sql:4`): a regex that trims
spaces, tabs, newlines, no-break spaces (U+00A0) and the byte-order mark (U+FEFF) from both ends.
Postgres `trim()` only strips plain spaces, and the mock reports are messy on purpose (D-031). Its
own test: `assert_clean_text_strips_nbsp_and_bom`
(`analytics/tests/assert_clean_text_strips_nbsp_and_bom.sql:2`).

| Raw column (text) | Staged column(s) | Transform | Where |
|---|---|---|---|
| `worker_id` | `worker_id` | `clean_text`, blank becomes null; not re-cased | `analytics/models/staging/workday/stg_workday__worker_report.sql:23` |
| `worker_name` (`Last, First`) | `last_name`, `first_name` | Split at the first comma, each part cleaned | `analytics/models/staging/workday/stg_workday__worker_report.sql:26` |
| `work_email` | `work_email` | Cleaned, not lower-cased (same as the loader) | `analytics/models/staging/workday/stg_workday__worker_report.sql:29` |
| `worker_type` (`Employee`, `Contingent Worker`) | `worker_type` (`employee`, `contingent`) | `case`; anything else is null | `analytics/models/staging/workday/stg_workday__worker_report.sql:31` |
| `worker_status` (`Active`, `On Leave`, `Terminated`) | `worker_status` (`active`, `leave`, `terminated`) | `case`; anything else is null | `analytics/models/staging/workday/stg_workday__worker_report.sql:36` |
| `hire_date`, `termination_date`, `contract_end_date` (`MM/DD/YYYY`) | Same names, as `date` | `to_date(..., 'MM/DD/YYYY')`; blank becomes null | `analytics/models/staging/workday/stg_workday__worker_report.sql:43` |
| `manager_id`, `job_title`, `position_id`, `cost_center`, `location` | Same names | Cleaned, blank becomes null | `analytics/models/staging/workday/stg_workday__worker_report.sql:47` |
| `supervisory_organization` (`Name (Manager Name)`) | `supervisory_org_name`, `supervisory_org_manager_name` | Regex: the name before the final parenthesis, the manager inside it | `analytics/models/staging/workday/stg_workday__worker_report.sql:61` |
| `cost_center` (`CC-1010 Digital Channels`) | `cost_center_code`, `cost_center_name` | Regex: the `CC-` code, then the name (a group name, D-029) | `analytics/models/staging/workday/stg_workday__worker_report.sql:66` |
| (derived) | `is_future_hire` | `hire_date > report_date`: in the report, but not started yet | `analytics/models/staging/workday/stg_workday__worker_report.sql:69` |

Tests that prove the cleaning:

- `assert_worker_report_cleaning_is_one_to_one`
  (`analytics/tests/assert_worker_report_cleaning_is_one_to_one.sql:5`): every raw row maps to
  exactly one staged row, and none has a null status, type or hire date (which is what a failed
  mapping would leave).
- `unique_combination_of_columns` on `(report_date, worker_id)`
  (`analytics/models/staging/workday/_workday__models.yml:11`), and `accepted_values` on
  `worker_type`, `worker_status` and `is_future_hire`.
- A `relationships` test from `cost_center_name` to `stg_app__groups.group_name`, at severity
  `warn` (`analytics/models/staging/workday/_workday__models.yml:96`): a cost center that matches
  no group isn't wrong, it just can't count toward a group's hiring gap.
- `assert_latest_report_staging_matches_workers` (section 1): SQL cleaning equals TypeScript
  cleaning.

`stg_workday__ingest_runs` and the `stg_app__*` models are plain selects and renames (for example
`status as seat_status` at `analytics/models/staging/app/stg_app__seats.sql:5`).

## 3. Intermediate: where the history logic lives

| Model | Grain | What it does |
|---|---|---|
| `int_worker_latest_report` | worker | Each worker's row from the newest report they appear in, by `row_number()` per worker ordered by report date (`analytics/models/intermediate/int_worker_latest_report.sql:12`). `is_in_latest_report` (`analytics/models/intermediate/int_worker_latest_report.sql:24`) says whether that row is from the newest report. |
| `int_worker_report_versions` | worker x report date | Each report paired with the previous one by `lag()` (`analytics/models/intermediate/int_worker_report_versions.sql:7`), then a `full join` of the two reports' rows (`analytics/models/intermediate/int_worker_report_versions.sql:89`). A hire has nulls on the previous side; a drop-off has nulls on the current side. The first report has no rows. |
| `int_seat_state_as_of` | seat x report date | Every seat's state on each report date, rebuilt from the audit log (section 5). |
| `int_squad_seat_counts` | squad x report date | Seats counted by state with `count(*) filter (where ...)` (`analytics/models/intermediate/int_squad_seat_counts.sql:4`). |
| `int_seat_occupancy` | seat x worker x period | Who held which seat from when to when, from the audit log (`analytics/models/intermediate/int_seat_occupancy.sql:13`). Feeds the `no_double_seating` test (`analytics/tests/no_double_seating.sql:8`): no worker holds two seats on any date in history. |

There are no snapshots yet. The `snapshots` layer comes with BR-05, and D-016 explains why
history is built from successive full extracts rather than relying on snapshots: a snapshot only
records changes from its first run.

## 4. Every mart's grain

Each mart has a test on its grain (a project rule): `unique` + `not_null` on a single key, or
`dbt_utils.unique_combination_of_columns` for a composite one.

| Mart | Grain | Grain test | What it's for |
|---|---|---|---|
| `dim_squads` (`analytics/models/marts/dim_squads.sql:1`) | squad | `unique` + `not_null` on `squad_id` (`analytics/models/marts/_marts.yml:9`) | The org hierarchy (squad, group, division) everything else groups by. |
| `dim_people` (`analytics/models/marts/dim_people.sql:1`) | worker | `unique` + `not_null` on `worker_id` (`analytics/models/marts/_marts.yml:36`) | Every worker ever seen, from their latest report row, plus the seat they hold in the plan now (`analytics/models/marts/dim_people.sql:24`). `current_seat_id` is also `unique`: one seat per worker. |
| `rpt_squad_headcount` (`analytics/models/marts/rpt_squad_headcount.sql:18`) | squad x report date | `unique_combination_of_columns` on `(squad_id, report_date)` (`analytics/models/marts/_marts.yml:125`) | Seats as of each report date against that quarter's approved plan: variance and fill rate. |
| `rpt_workday_changes` (`analytics/models/marts/rpt_workday_changes.sql:26`) | worker x report date | `unique_combination_of_columns` on `(worker_id, report_date)` (`analytics/models/marts/_marts.yml:192`) | What changed for each worker since the previous report. Only workers with a change get a row. |
| `rpt_reconciliation_exceptions` (`analytics/models/marts/rpt_reconciliation_exceptions.sql:12`) | exception type x subject | `unique_combination_of_columns` on `(exception_type, subject_id)` (`analytics/models/marts/_marts.yml:283`) | The work queue: where the latest Workday report and the seat plan disagree. |

**`rpt_squad_headcount` formulas.** The plan quarter is `date_trunc('quarter', report_date)`
(`analytics/models/marts/rpt_squad_headcount.sql:23`), so a report in December is checked against Q4's
plan and one in January against Q1's. Variance is committed seats (filled employee + filled
contingent + offer accepted) minus approved seats (`analytics/models/marts/rpt_squad_headcount.sql:62`):
positive means over plan, which the `squad_not_over_plan` test fails on
(`analytics/tests/squad_not_over_plan.sql:7`). Fill rate is filled seats over approved seats,
`nullif` guarding division by zero (`analytics/models/marts/rpt_squad_headcount.sql:64`). An
accepted offer counts toward the plan (the seat is committed) but not toward fill rate (nobody is in
it yet).

**`rpt_workday_changes` classification.** One change type per row, the first `when` that applies
in the `case` at `analytics/models/marts/rpt_workday_changes.sql:30`, so a worker who is terminated
and changes manager in the same report is a `termination`. The interesting pair is how a worker
drops off a report. The report population rule (D-031) is: every active and on-leave worker, plus
terminated workers whose termination date is in the 30 days up to and including the report date
(`analytics/dbt_project.yml:15`, the same rule as the seed). So:

- `aged_out`: they were terminated before this report's window starts
  (`analytics/models/marts/rpt_workday_changes.sql:21`). Leaving the report is expected. Not an
  exception.
- `missing`: anything else. They should still be in the report and aren't.

The unit test `workday_changes_types_precedence_and_window_boundary`
(`analytics/models/marts/_unit_tests.yml:73`) pins the boundary: terminated exactly on the window
start is `missing`; one day earlier is `aged_out`.

## 5. Headcount as of each report date (D-036)

**The problem.** Headcount is a point-in-time measure. `app.seats` is the live plan, and it
already includes moves saved with a future effective date (D-012: the board shows the planned state
as soon as a move is saved). If every report date's row used today's seat counts, last month's row
would change every time a leader moved someone, and a move effective next quarter would count
against this quarter's plan, which could fail `squad_not_over_plan` falsely across a quarter
boundary.

**The fix.** Start from the live seats and rewind every change whose effective date is after the
report date, using the change's `from_*` columns
(`analytics/models/intermediate/int_seat_state_as_of.sql:1`).

**The trick that makes it one query.** If a seat has three changes after the report date, rewinding
them newest first ends at the `from_*` state of the earliest of the three. So you don't have to
replay a chain: for each (seat, report date), take the earliest later change
(`distinct on (seat_id, report_date) ... order by effective_date, change_id`,
`analytics/models/intermediate/int_seat_state_as_of.sql:31`) and use its `from_status` and
`from_worker_id`. A seat with no later change keeps its live state
(`analytics/models/intermediate/int_seat_state_as_of.sql:51`). A seat's squad and type never change,
so those come straight from the live row.

**Worked example.** Report dates 11-15 and 12-05. A worker is moved out of seat 1 (filled to
backfill) effective 12-01. For 12-05 there's no change after the date, so seat 1 is `backfill`
(live). For 11-15 the 12-01 change is later, so seat 1 is that change's `from_status`, `filled`,
with the worker in it.

**Why it's only correct because the audit log is append-only and never backdated.** Ordering by
`(effective_date, change_id)` gives the true history only if no writer slips a change in with an
earlier date than one already recorded (D-037, D-038). The move service enforces that
(`EFFECTIVE_DATE_BEFORE_PENDING_CHANGE`; see the write-back explainer), and
`assert_seat_changes_effective_dates_in_save_order`
(`analytics/tests/assert_seat_changes_effective_dates_in_save_order.sql:8`) is a warn-level backstop
in dbt. This is the connection between the two halves of the project: the audit trail isn't only
for compliance, it's the source of the history the analytics read.

**Tests.**

- Unit test `seat_state_rewinds_future_changes`
  (`analytics/models/intermediate/_unit_tests.yml:122`): two report dates, moves on several seats,
  a chain of two changes on one seat, and a change exactly on a report date (which counts as
  already effective, because the join is `effective_date > report_date`).
- `assert_squad_headcount_matches_live_seats`
  (`analytics/tests/assert_squad_headcount_matches_live_seats.sql:15`): for the latest report, the
  mart's counts equal counts taken straight from `app.seats`, but only when no change is effective
  after that report date. When one is, the two differ on purpose and the test has nothing to
  compare.
- Grain test on `int_seat_state_as_of`: `(seat_id, report_date)`
  (`analytics/models/intermediate/_intermediate.yml:70`).

## 6. The reconciliation rules

`rpt_reconciliation_exceptions` compares **the latest Workday report** with **the seat plan as
saved now** (`app.seats`), not the plan as of the report date (the header comment at
`analytics/models/marts/rpt_reconciliation_exceptions.sql:1` says why: it's a work queue, and a fix
a leader saves should clear the exception on the next build). Each rule is a CTE that produces rows
of the same shape, and they're combined with `union all`
(`analytics/models/marts/rpt_reconciliation_exceptions.sql:178`). The subject is a worker, except
for `hiring_gap`, whose subject is a group.

Most worker rules start from `seated` (`analytics/models/marts/rpt_reconciliation_exceptions.sql:19`):
every filled seat in the plan, left-joined to the worker's latest Workday row. It's a left join on
purpose: a seated worker who is in no report at all still comes through, with nulls.

**One problem, one row.** The status and type rules only look at workers who are in the latest
report. A seated worker who isn't in it gets `seated_missing_from_report` and nothing else, even if
their last known status was terminated (Rob's decision on LR-03-04, option b). Otherwise one
departed worker could show up as two or three exceptions.

### Each exception type

**`terminated_seated`** (error,
`analytics/models/marts/rpt_reconciliation_exceptions.sql:36`). In the latest report as
`terminated`, still holds a seat. Workday is the source of truth for employment, so the plan is
wrong: the seat should be vacated (it becomes `backfill`). This is the headline demo case: the
board still renders and flags it rather than crashing. Tests: the singular test
`assert_terminated_seated_workers_are_exceptions`
(`analytics/tests/assert_terminated_seated_workers_are_exceptions.sql:10`) checks every terminated
seated worker is caught under the right type; the unit test `reconciliation_exceptions_every_type`
(case `TERM`); and the seed list (8 rows).

**`seated_missing_from_report`** (error,
`analytics/models/marts/rpt_reconciliation_exceptions.sql:53`). Holds a seat but isn't in the latest
report. Either they dropped out of the extract without a termination, or they aged out after a
termination nobody acted on, or they were never in any report. The detail says when they were last
seen. Tests: `reconciliation_exceptions_every_type` (cases `GHOST`, in no report, and `DROP`,
dropped with no termination and only one row); `assert_aged_out_is_not_an_exception_but_missing_is`
(`analytics/tests/assert_aged_out_is_not_an_exception_but_missing_is.sql:14`), which checks the
seed's worker 100878 is `seated_missing_from_report` exactly once; and the seed list.

**`missing_without_termination`** (warning,
`analytics/models/marts/rpt_reconciliation_exceptions.sql:74`). Holds no seat, was in the previous
report as active or on leave, and is missing from the latest one. The plan isn't wrong (there's no
seat to fix), so it's a warning for the HRIS team: a worker shouldn't vanish from a full extract
without a termination. It reads `int_worker_report_versions` for the latest report only, and
excludes seated workers (`analytics/models/marts/rpt_reconciliation_exceptions.sql:92`) so they
aren't double-counted. Tests: `reconciliation_exceptions_every_type` (case `GONE`; case `AGED`,
previously terminated, is correctly not flagged). The seed has none: its one missing worker is
seated.

**`worker_type_mismatch`** (error,
`analytics/models/marts/rpt_reconciliation_exceptions.sql:100`). The worker's Workday type differs
from the seat's type: an employee in a contingent seat, or the reverse. The move service prevents
this for moves (`SEAT_TYPE_MISMATCH`), so it shows up when Workday changes the worker's type (a
contractor converted to an employee). Tests: `reconciliation_exceptions_every_type` (case `TYPE`).
The seed has none.

**`on_leave_seated`** (info,
`analytics/models/marts/rpt_reconciliation_exceptions.sql:118`). On leave and holds a seat. That's
allowed (a worker on leave keeps their seat), so it's `info`: worth seeing when planning, nothing to
fix. Tests: `reconciliation_exceptions_every_type` (case `LEAVE`) and the seed list (21 rows).

**`hiring_gap`** (info, `analytics/models/marts/rpt_reconciliation_exceptions.sql:158`). See below.

### The hiring-gap check: hiring without a TA feed (D-031, D-033)

A seat in `offer_accepted` is reserved for someone who said yes. In a real company that person
should appear in Workday as a future-dated hire (in the report, start date after the report date)
before they start. There is no Talent Acquisition feed before the interview (D-033), but the
Workday report already carries future hires, so the check is:

1. Count `offer_accepted` seats per group in the live plan (`group_offers`,
   `analytics/models/marts/rpt_reconciliation_exceptions.sql:137`).
2. Count future-dated hires per group in the latest report (`group_future_hires`,
   `analytics/models/marts/rpt_reconciliation_exceptions.sql:147`). A Workday row is matched to a
   group by its cost center name, because each cost center is named after one group (D-029) and
   seats aren't linked to Workday positions.
3. Flag the group when offers outnumber future hires
   (`analytics/models/marts/rpt_reconciliation_exceptions.sql:174`).

It's at group level, and it compares counts rather than matching people, because there's nothing to
match on: a seat has no candidate and no position. Honest limitations: it's one-directional (more
future hires than offers isn't flagged), and two errors in one group can cancel out (an offer with
no hire plus a hire with no offer). Those are exactly what a TA feed fixes.

Tests: `reconciliation_exceptions_every_type` (group 10 has two offers and one future hire, so it's
flagged; group 20 has one of each, so it isn't); and the seed list (8 groups).

### Every exception type and the test that covers it

| Type | Severity | Subject | dbt tests |
|---|---|---|---|
| `terminated_seated` | error | worker | `assert_terminated_seated_workers_are_exceptions`; unit test `reconciliation_exceptions_every_type` (case `TERM`); `assert_reconciliation_exceptions_match_seed_readme` (8 rows) |
| `seated_missing_from_report` | error | worker | unit test `reconciliation_exceptions_every_type` (cases `GHOST`, `DROP`); `assert_aged_out_is_not_an_exception_but_missing_is`; `assert_terminated_seated_workers_are_exceptions` (an aged-out terminated worker still seated); `assert_reconciliation_exceptions_match_seed_readme` (1 row) |
| `missing_without_termination` | warning | worker | unit test `reconciliation_exceptions_every_type` (case `GONE`; `AGED` and `DROP` are negative cases) |
| `worker_type_mismatch` | error | worker | unit test `reconciliation_exceptions_every_type` (case `TYPE`) |
| `on_leave_seated` | info | worker | unit test `reconciliation_exceptions_every_type` (case `LEAVE`); `assert_reconciliation_exceptions_match_seed_readme` (21 rows) |
| `hiring_gap` | info | group | unit test `reconciliation_exceptions_every_type` (groups 10 and 20); `assert_reconciliation_exceptions_match_seed_readme` (8 rows) |

The unit test is at `analytics/models/marts/_unit_tests.yml:123`. Every type is also covered by the
`accepted_values` test on `exception_type` (`analytics/models/marts/_marts.yml:291`), so a typo in a
new rule's type name fails the build, and by the grain test on `(exception_type, subject_id)`.

### What is not an exception

- A matching seated worker (case `OK` in the unit test).
- An unseated terminated worker who ages out of the report (`aged_out` in `rpt_workday_changes`).
  `assert_aged_out_is_not_an_exception_but_missing_is` checks the seed's three aged-out workers
  (102005, 102006, 102007) appear in no exception row.
- An unseated worker who was terminated in the previous report and then dropped off inside the
  window. `rpt_workday_changes` calls that `missing` (the window says they should still be listed),
  but there's no seat to fix and their termination is on record, so the exceptions mart doesn't
  flag it. The mart description at `analytics/models/marts/_marts.yml:264` says exactly which
  `missing` workers are exceptions.

### The seed-list tests and their gate

Three tests compare the marts with fixed lists written in `scripts/seed/README.md`:
`assert_reconciliation_exceptions_match_seed_readme`
(`analytics/tests/assert_reconciliation_exceptions_match_seed_readme.sql:14`, all 38 rows, both
ways), `assert_workday_changes_match_seed_readme`, and
`assert_aged_out_is_not_an_exception_but_missing_is`. The Vitest test "lists the documented
reconciliation exceptions in assert_reconciliation_exceptions_match_seed_readme"
(`tests/unit/seed-readme-dbt.test.ts:24`) checks the SQL list and the README table agree, so the
docs and the test can't drift.

Those lists only describe the seed state, so the tests run only when the macro
`seed_list_tests_active` (`analytics/macros/seed_list_tests_active.sql:16`) is true: the latest
report is 11-15 and no seat change has been saved. That's a check on the data, not a flag a fixture
build sets. Anywhere else they skip, and `assert_seed_list_tests_are_active` warns that they're
skipping. CI runs that warning test with `--warn-error` on a freshly seeded database
(`.github/workflows/ci.yml:155`), so in CI a closed gate is a failure, not a silent pass.

## 7. Extending to TA and FP&A feeds

The planned next step is LR-07-04 (BR-07): a mock Talent Acquisition offers report (candidate,
squad, start date, status) and an FP&A approved-headcount feed (squad, quarter). Each new source
follows the same pattern as Workday, which is the point of building the pattern first:

1. **Ingest.** A new reader for each file, the same contract: validate the whole file, land raw
   text, record runs, skip by hash. The reader interface (`scripts/ingest/reader.ts:16`) and the
   validate-then-load structure carry over; each feed gets its own column list and rules.
2. **Staging.** `stg_ta__offers`, `stg_fpa__approved_headcount`: cast, map status text to enums,
   no joins.
3. **New rules in the exceptions mart.** Each is one more CTE in the `union all`:
   - *`offer_accepted` seat with no TA offer*: matched at squad level, because the TA feed carries
     a squad. That replaces today's group-level count with a real match.
   - *TA start date passed, no Workday hire*: join the offer's candidate to a Workday worker. That
     needs a shared key (a pre-hire ID or email), which is the main design question.
   - *App plan differs from FP&A*: compare `app.headcount_plan` with the FP&A feed per squad and
     quarter. That's a new subject type (a squad-quarter), so the `subject_type` expression at
     `analytics/models/marts/rpt_reconciliation_exceptions.sql:197` would grow a branch.
4. **Keep `hiring_gap` as the fallback.** It needs no TA feed, so it still works for any group or
   period the feed doesn't cover; once TA is trusted it can drop to a cross-check.
5. **Tests**, the same way: a new value in `accepted_values`, a case in
   `reconciliation_exceptions_every_type`, a seeded case that appears exactly once, and the seed
   README list updated.

The FP&A feed is also where cost-aware planning would start (standard cost per job level and
location, quarterly budget per cost center, an over-budget warning on a move), parked in
`docs/PARKING_LOT.md`.

## 8. `pnpm run pipeline`, the GitHub Actions workflow, and Airflow (D-020)

Two steps don't justify running Airflow, so the pipeline is a script plus a manual workflow, and
`docs/orchestration.md` maps each step to its Airflow task. Use `pnpm run pipeline`: pnpm 12 has a
built-in `pipeline` command that shadows the script.

**The script** (`scripts/pipeline.ts`):

1. Find the reports: `--report <file>`, or every `data/workday/worker_report_*.csv` sorted by name,
   which is date order because the dates are ISO (`scripts/pipeline.ts:37`).
2. Build a list of steps: one `ingest` step per file, calling the same `ingestReport`
   (`scripts/pipeline.ts:98`), then a `dbt build` step (`scripts/pipeline.ts:112`) that runs
   `uv run dbt build` in `analytics/` and echoes its output (`scripts/pipeline.ts:57`).
3. Run them in order and stop at the first failure (`runSteps`, `scripts/pipeline-lib.ts:29`). A
   rejected report is a failed step, so dbt never runs on a half-refreshed state. A thrown error is
   also a failed step, with the connection string redacted.
4. If everything passed, read exception counts by type from the mart
   (`scripts/pipeline.ts:125`) and print a summary: rows per report, models built, tests passed /
   warned / failed (parsed from dbt's output, `scripts/pipeline-lib.ts:62`), exceptions by type.
5. Exit 1 if any step failed (`scripts/pipeline-lib.ts:99`). That exit code is what turns CI or a
   scheduler red.

The step runner, the dbt output parser and the summary are pure functions in
`scripts/pipeline-lib.ts`, so they're unit tested with stubbed steps: "stops at the first failing
step (a failing dbt test) and never runs later steps" (`tests/unit/pipeline-lib.test.ts:27`) and
"dbt exit code 1 fails the step, the summary and the process exit code"
(`tests/unit/pipeline-lib.test.ts:81`).

**The GitHub Actions workflow** (`.github/workflows/pipeline.yml`) runs the same script against
Neon:

- Manual trigger only (`.github/workflows/pipeline.yml:6`); a biweekly schedule is LR-07-06.
- `concurrency: pipeline` with no cancel (`.github/workflows/pipeline.yml:12`): one run at a time,
  queued, like Airflow's `max_active_runs=1`. The advisory lock in ingest is the same guarantee one
  level down.
- Secrets arrive only as environment variables (`.github/workflows/pipeline.yml:20`), never as
  arguments, so they can't show up in a process list or log.
- It writes the report CSVs with `pnpm run workday:reports` (`.github/workflows/pipeline.yml:58`),
  touching no database, then runs `pnpm run pipeline` (`.github/workflows/pipeline.yml:61`). It
  never migrates or reseeds, so leaders' live edits on the demo survive a refresh.

CI also runs the pipeline: the `db` job builds the marts with `pnpm run pipeline`
(`.github/workflows/ci.yml:78`) before the Playwright tests, so the SQL panel's analytics presets
have data, and the `dbt` job
ingests 11-15 and runs `dbt build` directly (`.github/workflows/ci.yml:141`,
`.github/workflows/ci.yml:150`).

**Mapped to Airflow** (the full table is at `docs/orchestration.md:20`):

| Today | Airflow in production |
|---|---|
| Report CSV in `data/workday/` | A sensor on the biweekly report drop (S3/GCS key or file sensor), with a timeout; a report that never arrives fails the run, which is itself an alert |
| One `ingestReport` per file | One task per report (`BashOperator` running `pnpm workday:ingest`, or a Python task), no retries on a rejected file; retries are safe on a transient error because ingest is idempotent |
| `dbt build` | A `BashOperator` or Cosmos `DbtTaskGroup` downstream of every ingest task; a failing test fails the task |
| Exception counts in the summary | A SQL check task after dbt, then an alert when `error` rows cross a threshold |
| Exit code 1, red workflow | `on_failure_callback` to Slack or email |
| `concurrency: pipeline`, advisory lock | `max_active_runs=1`, or a pool of size one |

## 9. What changes in production: Workday API, Airflow, Snowflake

- **Workday API instead of CSV files.** A Workday custom report can be exposed as a web service
  (Report-as-a-Service) returning CSV or JSON, called by an integration system user. A
  `RaasReportReader` implements the same `ReportReader` interface
  (`scripts/ingest/reader.ts:16`) and fills the same `ReportSource`: a name, a hash of the response
  body, and rows of text. Validation, loading and everything in dbt stay the same; BR-07's exit
  criterion is that the CSV and API readers produce identical staged data (LR-07-03).
- **Airflow instead of the script.** The steps in section 8 become tasks. What Airflow adds that the
  stand-in doesn't have: a real schedule, sensors, retries with backoff, backfills, SLAs, and
  paging. One rule would need to change for backfills: ingest refuses a report older than the
  newest loaded one (`scripts/ingest/load.ts:185`). A backfill would load older raw rows for history
  while leaving the current table alone.
- **Snowflake instead of Postgres `analytics`.**
  - Landing: the extract goes to a stage (S3), and `COPY INTO` a raw table loads it. Snowflake's
    load metadata already skips files it has loaded, which is the file-hash rule; the
    validate-first step would run before the copy (or load to a quarantine table and validate in
    SQL).
  - The advisory lock goes away; Airflow's single active run serializes loads.
  - dbt runs with the Snowflake adapter. A few Postgres-only constructs need a rewrite:
    `distinct on` becomes `qualify row_number() over (...) = 1`, `count(*) filter (where ...)`
    becomes `count_if(...)`, and the `substring(... from regex)` calls become `regexp_substr`.
    The models' logic doesn't change.
  - dbt Core moves to dbt Cloud (or stays on Airflow via Cosmos), and the MetricFlow semantic layer
    (BR-06) can then be served to BI tools.
- **The app stays on Postgres.** Write-back needs row locks, transactions and triggers. The
  warehouse is for analytics; the app's tables would be replicated into it (CDC or a nightly
  extract), not written there.
- **Roles (BR-07).** The app runs as a role that can't write `workday`; ingest runs as its own role;
  dbt reads `app` and `workday` and writes only its schemas.

## 10. Likely interview questions

1. **Why validate the whole file before loading anything?** A half-loaded report is worse than no
   report: some workers would be on the new extract and some on the old, and every downstream
   number would be a mix. So the validator collects every problem in one pass, and the load is one
   transaction that either commits all rows or none. A rejected file leaves the previous report
   current.
2. **Why keep raw rows and a typed table?** Raw is the audit trail: exactly what Workday sent, every
   report, so you can re-clean history if the cleaning was wrong. The typed current table is what
   the app reads at request time. A dbt test checks the two cleanings agree.
3. **How is ingest idempotent?** By SHA-256 of the file's bytes. If a `loaded` run already has that
   hash, the run is recorded as `skipped` and nothing changes. A different file with the same report
   date is refused by the "must be newer" rule, so re-running the pipeline is always safe.
4. **A worker disappears from the latest report. What happens?** Nothing is deleted. Their current
   row keeps an older `as_of_report_date`. dbt classifies the drop-off: `aged_out` if they were
   terminated before the report's 30-day window (expected), `missing` otherwise. A missing worker
   who holds a seat is a `seated_missing_from_report` error; an unseated one who was active or on
   leave is a `missing_without_termination` warning.
5. **Why is the cleaning in dbt and not the loader?** Raw stays untouched, so cleaning can be fixed
   and rerun over every past report with one `dbt build`, and it's tested next to the models that
   use it. The loader does type the current table for the app, and a test pins it to staging.
6. **How do you compute headcount for a past report date when the seats table is live?** Rewind the
   audit log. For each seat and report date, take the earliest change effective after that date and
   use its `from_*` state; with no later change, the live state is right. That only works because
   the audit log is append-only and never backdated.
7. **Why can't you sum headcount across report dates?** It's a point-in-time (semi-additive)
   measure. Summing two biweekly rows counts the same people twice. You take the value at a date,
   or average over a period.
8. **Walk me through one reconciliation rule.** `terminated_seated`: take every filled seat in the
   plan, left-join each worker's latest Workday row, keep the ones in the latest report with status
   `terminated`. Severity error, because Workday is the source of truth and the plan is wrong. The
   fix is to vacate the seat, which becomes `backfill`.
9. **Why does a seated worker missing from the report get only one exception?** One problem, one
   row. Status and type rules only look at workers in the latest report, and
   `missing_without_termination` excludes seated workers. Otherwise one departure would be two or
   three rows and the queue would look worse than it is.
10. **How do you check hiring without a recruiting system?** Accepted offers should show up in
    Workday as future-dated hires. Per group, compare `offer_accepted` seats with future hires
    (matched by cost center name) and flag groups with more offers than hires. It's a count, not a
    match, so it's coarse; the TA feed in BR-07 matches per squad and candidate.
11. **How would you add the TA and FP&A feeds?** Same pattern as Workday: a reader with
    validate-then-load and hash idempotency, a staging model, then one more CTE per rule in the
    exceptions mart, with `accepted_values`, a unit test case and a seeded case for each.
12. **What would you change for production?** The Workday RaaS API behind the same reader interface,
    Airflow for scheduling, sensors, retries and alerting, Snowflake for the warehouse (`COPY INTO`
    from a stage, a few SQL dialect rewrites), dbt Cloud for the semantic layer, and separate
    database roles. The app stays on Postgres, because write-back needs transactions and row locks.
