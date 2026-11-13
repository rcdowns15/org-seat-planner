{{ config(severity='warn') }}

-- The seed-list tests (assert_workday_changes_match_seed_readme,
-- assert_reconciliation_exceptions_match_seed_readme and
-- assert_aged_out_is_not_an_exception_but_missing_is) only check anything once the 2026-11-15
-- report is ingested; without it they pass with nothing checked. This test makes that visible: it
-- warns when the 11-15 report isn't loaded. `pnpm db:seed` loads 11-01 only; CI ingests 11-15
-- before `dbt build`.
-- Warn, not error: a database with only the first report is a valid state, just not a tested one.

select date '2026-11-15' as missing_report_date
where not exists (
    select 1
    from {{ ref('stg_workday__worker_report') }}
    where report_date = date '2026-11-15'
)
