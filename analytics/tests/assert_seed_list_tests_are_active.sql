{{ config(severity='warn') }}

-- The seed-list tests (assert_workday_changes_match_seed_readme,
-- assert_reconciliation_exceptions_match_seed_readme and
-- assert_aged_out_is_not_an_exception_but_missing_is) compare the marts with fixed lists in
-- scripts/seed/README.md, so they check anything only in the seed state
-- (macros/seed_list_tests_active.sql): the latest report is 2026-11-15 and no seat change has been
-- saved. Anywhere else (only the 11-01 report, a third report, or after a move or undo) they pass
-- with nothing checked. This test makes that visible: it warns, with the reason, whenever they are
-- skipping.
-- Warn, not error: a database that has been used is a valid state, just not one the seed lists
-- describe. CI runs this test with --warn-error after `dbt build`, so on CI's freshly seeded
-- database a closed gate fails the build.

with state as (

    select
        (select max(report_date) from {{ ref('stg_workday__worker_report') }}) as latest_report_date,
        (select count(*) from {{ source('app', 'seat_changes') }}) as seat_change_count

)

select
    latest_report_date,
    seat_change_count,
    case
        when latest_report_date is distinct from date '2026-11-15'
            then 'latest report is not 2026-11-15'
        else 'seat changes have been saved since the seed'
    end as reason
from state
where not {{ seed_list_tests_active() }}
