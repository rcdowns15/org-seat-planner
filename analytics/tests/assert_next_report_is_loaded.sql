{{ config(severity='warn') }}

-- The refresh-changes and reconciliation checks need the 2026-11-15 report: `pnpm db:seed` loads
-- 11-01 only, and CI ingests 11-15 before `dbt build`. This test warns when the 11-15 report isn't
-- loaded. assert_seed_list_tests_are_active covers the wider seed-state gate the seed-list tests
-- use (latest report is 11-15 and no seat change saved); CI runs both with --warn-error.
-- Warn, not error: a database with only the first report is a valid state, just not a tested one.

select date '2026-11-15' as missing_report_date
where not exists (
    select 1
    from {{ ref('stg_workday__worker_report') }}
    where report_date = date '2026-11-15'
)
