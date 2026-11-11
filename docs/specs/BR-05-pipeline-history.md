# BR-05 — Pipeline depth: history, SCD2, daily headcount

**Status:** todo · **Depends on:** BR-03 · **Milestone:** M5 · **Target:** after the interview · **Cut line:** no

## Goal
Eighteen months of biweekly Workday reports and seat history make trends real. dbt builds SCD2
worker history from successive full extracts, a snapshot shows SCD2 going forward, and daily seat and
headcount facts support point-in-time headcount.

## Why it matters
Headcount over time, as-of-date org views, and plan vs. actual by quarter all need correct history.
Building SCD2 from periodic full extracts is exactly how Workday report history usually gets modeled.

## Scope
In: history generator (biweekly report files + historical seat changes), `int_worker_history` from
extracts, snapshot, `dim_date`, `fct_seat_changes`, `fct_seats_daily`, `fct_headcount_daily`, dbt
modeling explainer.
Out: metrics (BR-06), dashboard (BR-08).

## Exit criteria
- Replaying history reproduces the current seat state exactly.
- `fct_headcount_daily` for today equals live counts from `app.seats`.
- Grain tests on every new mart; dbt build green locally, in CI and on Neon.

## Little rocks

### LR-05-01 · 18-month history generator · status: todo · depends: LR-03-01 · owner: agent · executor model: opus
Generate backward from the current seeded state so BR-02 and BR-03 fixtures don't change: ~39
biweekly Workday report CSVs (2025-05 → 2026-11) and historical `app.seat_changes` (moves, fills,
vacancies, with backdated `created_at`), plus plan rows for the past 6 quarters. `pnpm pipeline
--all-reports` ingests them in order.
- [ ] Replaying all seat changes from the start state reproduces the current seat state exactly (test)
- [ ] No double-seating on any day of the history (SQL test)
- [ ] The 11-01 and 11-15 reports and the current-state checksum are unchanged
Likely files: `scripts/seed/history.ts`, `scripts/seed/workday-reports.ts`, `scripts/pipeline.ts`, `tests/db/history-replay.test.ts`.

### LR-05-02 · Worker history (SCD2) from extracts, plus a snapshot · status: todo · depends: LR-05-01 · owner: agent · executor model: sonnet
`int_worker_history`: SCD2 rows (`valid_from`, `valid_to`, `is_current`) built from consecutive
reports, opening a new version only when tracked attributes change. `snap_workday__workers` on the
current table (check strategy) to show dbt snapshots going forward, documented as the "if the source
only gives current state" pattern.
- [ ] No overlapping validity ranges per worker (test); exactly one `is_current` row per worker
- [ ] A worker whose manager changed in a known report has two versions split at that report date (singular test)
Likely files: `analytics/models/intermediate/int_worker_history.sql`, `analytics/snapshots/**`.

### LR-05-03 · `dim_date`, `fct_seat_changes`, daily seat and headcount facts · status: todo · depends: LR-05-02 · owner: agent · executor model: opus
`dim_date` (with quarter fields), `fct_seat_changes` (one row per change, move grouping,
`is_reversal`), `fct_seats_daily` (seat × day), `fct_headcount_daily` (squad × day × worker type:
filled, open, backfill, offer accepted, approved plan). Full rebuilds are fine at this size; document
when to switch to incremental.
- [ ] Composite grain tests on the daily facts
- [ ] Today's `fct_headcount_daily` equals live counts from `app.seats` (singular test)
- [ ] Month-end headcount for 3 sampled months matches a hand-written SQL check in the PR
Likely files: `analytics/models/marts/dim_date.sql`, `analytics/models/marts/fct_*.sql`, `analytics/models/intermediate/int_seat_status_spans.sql`.

### LR-05-04 · dbt modeling explainer · status: todo · depends: LR-05-03 · owner: agent · executor model: sonnet
`docs/explainers/dbt-modeling.md`: layers, every grain, SCD2 from extracts vs. snapshots, why
headcount is point-in-time, lineage diagram, interview Q&A. Update README Built/Planned rows.
- [ ] `pnpm docs:check` passes; every mart's grain is stated and matches its test
Likely files: `docs/explainers/dbt-modeling.md`, `README.md`.
