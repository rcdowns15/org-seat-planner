-- rpt_reconciliation_exceptions must equal the list documented in scripts/seed/README.md
-- ("Reconciliation exceptions on the seed"): each seeded exception exactly once, and nothing else.
-- The expected rows are (exception_type, subject_id, severity). The mart's grain is
-- exception_type x subject_id (unique_combination_of_columns in _marts.yml), so a set comparison
-- here is also a row-for-row comparison. tests/unit/seed-readme-dbt.test.ts checks that this list
-- and the README table agree, so the two can't drift.
-- Returns rows that are expected but missing ('missing_from_mart') or present but not expected
-- ('unexpected_in_mart'). Checks only once the 2026-11-15 report is ingested (the list is for the
-- seed plus that report); assert_next_report_is_loaded warns when it isn't.

with expected (exception_type, subject_id, severity) as (

    values
        ('terminated_seated', '100047', 'error'),
        ('terminated_seated', '100052', 'error'),
        ('terminated_seated', '100515', 'error'),
        ('terminated_seated', '100540', 'error'),
        ('terminated_seated', '100883', 'error'),
        ('terminated_seated', '101365', 'error'),
        ('terminated_seated', '101441', 'error'),
        ('terminated_seated', '101600', 'error'),
        ('seated_missing_from_report', '100878', 'error'),
        ('on_leave_seated', '100042', 'info'),
        ('on_leave_seated', '100050', 'info'),
        ('on_leave_seated', '100082', 'info'),
        ('on_leave_seated', '100140', 'info'),
        ('on_leave_seated', '100246', 'info'),
        ('on_leave_seated', '100300', 'info'),
        ('on_leave_seated', '100363', 'info'),
        ('on_leave_seated', '100518', 'info'),
        ('on_leave_seated', '100641', 'info'),
        ('on_leave_seated', '100680', 'info'),
        ('on_leave_seated', '100759', 'info'),
        ('on_leave_seated', '100895', 'info'),
        ('on_leave_seated', '100950', 'info'),
        ('on_leave_seated', '100977', 'info'),
        ('on_leave_seated', '101205', 'info'),
        ('on_leave_seated', '101223', 'info'),
        ('on_leave_seated', '101380', 'info'),
        ('on_leave_seated', '101604', 'info'),
        ('on_leave_seated', '101674', 'info'),
        ('on_leave_seated', '101695', 'info'),
        ('on_leave_seated', '101874', 'info'),
        ('hiring_gap', '1', 'info'),
        ('hiring_gap', '3', 'info'),
        ('hiring_gap', '5', 'info'),
        ('hiring_gap', '6', 'info'),
        ('hiring_gap', '7', 'info'),
        ('hiring_gap', '8', 'info'),
        ('hiring_gap', '11', 'info'),
        ('hiring_gap', '12', 'info')

),

report_loaded as (

    select 1 as one
    where exists (
        select 1
        from {{ ref('stg_workday__worker_report') }}
        where report_date = date '2026-11-15'
    )

),

actual as (

    select exception_type, subject_id, severity
    from {{ ref('rpt_reconciliation_exceptions') }}

),

differences as (

    select 'missing_from_mart' as problem, exception_type, subject_id, severity
    from (select * from expected except select * from actual) as missing

    union all

    select 'unexpected_in_mart' as problem, exception_type, subject_id, severity
    from (select * from actual except select * from expected) as unexpected

)

select differences.*
from differences
cross join report_loaded
