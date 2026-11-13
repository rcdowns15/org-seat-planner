-- rpt_reconciliation_exceptions must equal the list documented in scripts/seed/README.md
-- ("Reconciliation exceptions on the seed"): each seeded exception exactly once, and nothing else.
-- The expected rows are (exception_type, subject_id, severity, seat_id); seat_id is text, '' for a
-- hiring_gap (no seat). The mart's grain is exception_type x subject_id
-- (unique_combination_of_columns in _marts.yml), so a set comparison here is also a row-for-row
-- comparison. tests/unit/seed-readme-dbt.test.ts checks that this list and the README table agree,
-- so the two can't drift.
-- Returns rows that are expected but missing ('missing_from_mart') or present but not expected
-- ('unexpected_in_mart').
-- Checks only in the seed state (macros/seed_list_tests_active.sql: latest report is 2026-11-15
-- and no seat change saved). After a move or a third report the list no longer describes the
-- data, so the test skips instead of failing; assert_seed_list_tests_are_active warns then.

with expected (exception_type, subject_id, severity, seat_id) as (

    values
        ('terminated_seated', '100047', 'error', '33'),
        ('terminated_seated', '100052', 'error', '39'),
        ('terminated_seated', '100515', 'error', '550'),
        ('terminated_seated', '100540', 'error', '577'),
        ('terminated_seated', '100883', 'error', '960'),
        ('terminated_seated', '101365', 'error', '1495'),
        ('terminated_seated', '101441', 'error', '1578'),
        ('terminated_seated', '101600', 'error', '1754'),
        ('seated_missing_from_report', '100878', 'error', '955'),
        ('on_leave_seated', '100042', 'info', '28'),
        ('on_leave_seated', '100050', 'info', '36'),
        ('on_leave_seated', '100082', 'info', '73'),
        ('on_leave_seated', '100140', 'info', '135'),
        ('on_leave_seated', '100246', 'info', '251'),
        ('on_leave_seated', '100300', 'info', '310'),
        ('on_leave_seated', '100363', 'info', '380'),
        ('on_leave_seated', '100518', 'info', '553'),
        ('on_leave_seated', '100641', 'info', '689'),
        ('on_leave_seated', '100680', 'info', '732'),
        ('on_leave_seated', '100759', 'info', '820'),
        ('on_leave_seated', '100895', 'info', '974'),
        ('on_leave_seated', '100950', 'info', '1035'),
        ('on_leave_seated', '100977', 'info', '1064'),
        ('on_leave_seated', '101205', 'info', '1318'),
        ('on_leave_seated', '101223', 'info', '1338'),
        ('on_leave_seated', '101380', 'info', '1511'),
        ('on_leave_seated', '101604', 'info', '1758'),
        ('on_leave_seated', '101674', 'info', '1836'),
        ('on_leave_seated', '101695', 'info', '1858'),
        ('on_leave_seated', '101874', 'info', '2057'),
        ('hiring_gap', '1', 'info', ''),
        ('hiring_gap', '3', 'info', ''),
        ('hiring_gap', '5', 'info', ''),
        ('hiring_gap', '6', 'info', ''),
        ('hiring_gap', '7', 'info', ''),
        ('hiring_gap', '8', 'info', ''),
        ('hiring_gap', '11', 'info', ''),
        ('hiring_gap', '12', 'info', '')

),

seed_state as (

    select 1 as one
    where {{ seed_list_tests_active() }}

),

actual as (

    select exception_type, subject_id, severity, coalesce(seat_id::text, '') as seat_id
    from {{ ref('rpt_reconciliation_exceptions') }}

),

differences as (

    select 'missing_from_mart' as problem, exception_type, subject_id, severity, seat_id
    from (select * from expected except select * from actual) as missing

    union all

    select 'unexpected_in_mart' as problem, exception_type, subject_id, severity, seat_id
    from (select * from actual except select * from expected) as unexpected

)

select differences.*
from differences
cross join seed_state
