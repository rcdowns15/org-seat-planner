{# A boolean SQL expression: true when the database is in the documented seed state, the state the
   seed-list tests (assert_workday_changes_match_seed_readme,
   assert_reconciliation_exceptions_match_seed_readme and
   assert_aged_out_is_not_an_exception_but_missing_is) describe:
     * the latest Workday report is 2026-11-15 (the seed's 11-01 report plus the 11-15 one, and
       no later report), and
     * no seat change has been saved (`pnpm db:seed` leaves app.seat_changes empty; any move,
       undo or demo edit adds rows).
   Outside that state the seed lists no longer describe the data (vacating a seat clears an
   exception; a third report changes the latest-report comparison), so the tests skip instead of
   failing, and assert_seed_list_tests_are_active warns that they are skipping.
   This is a check on the data, not a flag: a freshly seeded database with both reports (CI) is
   always in this state, so the tests run for real there.
   coalesce(..., false): with no report loaded, max() is null; the gate must read as closed, not
   unknown, so the warn test (`where not ...`) still fires. #}
{% macro seed_list_tests_active() -%}
coalesce(
    (select max(report_date) from {{ ref('stg_workday__worker_report') }}) = date '2026-11-15'
    and not exists (select 1 from {{ source('app', 'seat_changes') }}),
    false
)
{%- endmacro %}
