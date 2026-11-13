-- rpt_workday_changes for the 2026-11-15 report must equal the change list documented in
-- scripts/seed/README.md ("Changes in the 11-15 report"), row for row. The README's `leave` kind is
-- `leave_start` here (the README's report has only Active -> On Leave moves).
-- Returns rows that are expected but missing ('missing_from_mart') or present but not expected
-- ('unexpected_in_mart'). Checks only the 11-15 report, and only in the seed state
-- (macros/seed_list_tests_active.sql: latest report is 2026-11-15 and no seat change saved).
-- `pnpm db:seed` loads 11-01 alone and the comparison needs both reports (CI ingests 11-15 before
-- dbt build); a third report would make 11-15 no longer the latest. When the gate is closed the
-- test skips and assert_seed_list_tests_are_active warns.

with expected (worker_id, change_type) as (

    values
        ('102025', 'hire'),
        ('102026', 'hire'),
        ('102027', 'hire'),
        ('102028', 'hire'),
        ('102029', 'hire'),
        ('C-02030', 'hire'),
        ('102032', 'future_hire'),
        ('102033', 'future_hire'),
        ('C-02031', 'future_hire'),
        ('100047', 'termination'),
        ('100883', 'termination'),
        ('101365', 'termination'),
        ('101441', 'termination'),
        ('101600', 'termination'),
        ('100034', 'manager_change'),
        ('100330', 'manager_change'),
        ('101230', 'manager_change'),
        ('101283', 'manager_change'),
        ('100363', 'leave_start'),
        ('102005', 'aged_out'),
        ('102006', 'aged_out'),
        ('102007', 'aged_out'),
        ('100878', 'missing')

),

seed_state as (

    select 1 as one
    where {{ seed_list_tests_active() }}

),

actual as (

    select worker_id, change_type
    from {{ ref('rpt_workday_changes') }}
    where report_date = date '2026-11-15'

),

differences as (

    select 'missing_from_mart' as problem, worker_id, change_type
    from (select * from expected except select * from actual) as missing

    union all

    select 'unexpected_in_mart' as problem, worker_id, change_type
    from (select * from actual except select * from expected) as unexpected

)

select differences.*
from differences
cross join seed_state
