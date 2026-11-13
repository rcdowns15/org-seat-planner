-- Grain: worker x report date. What changed for a worker between a report and the previous one
-- (int_worker_report_versions). Workers with no change get no row.
--
-- One change type per row, picked in the order of the CASE below, so a worker who is terminated
-- and changes manager in the same report is a `termination`. The previous_* and current columns
-- show every attribute that moved.
--
-- Dropping off a report is `aged_out` when the worker was terminated before the report's
-- termination window (the report date minus window - 1 days through the report date, inclusive,
-- the rule the mock reports follow), and `missing` otherwise. A `missing` worker is an exception
-- in rpt_reconciliation_exceptions only when they hold a seat (`seated_missing_from_report`) or
-- were active or on leave in the previous report (`missing_without_termination`); `aged_out` is
-- not an exception.

{% set window_days = var('workday_termination_window_days') %}

with versions as (

    select
        *,
        report_date - ({{ window_days }} - 1) as termination_window_start
    from {{ ref('int_worker_report_versions') }}

),

classified as (

    select
        *,
        case
            -- New in this report.
            when not is_in_previous_report and is_future_hire then 'future_hire'
            when not is_in_previous_report then 'hire'
            -- Dropped from this report.
            when not is_in_report
                and previous_worker_status = 'terminated'
                and previous_termination_date < termination_window_start then 'aged_out'
            when not is_in_report then 'missing'
            -- In both reports.
            when worker_status = 'terminated'
                and previous_worker_status <> 'terminated' then 'termination'
            when worker_type <> previous_worker_type then 'worker_type_change'
            when worker_status = 'leave' and previous_worker_status = 'active' then 'leave_start'
            when worker_status = 'active' and previous_worker_status = 'leave' then 'leave_end'
            -- Any other status move (for example a rehire, terminated -> active).
            when worker_status <> previous_worker_status then 'status_change'
            when manager_id is distinct from previous_manager_id then 'manager_change'
        end as change_type
    from versions

)

select
    worker_id,
    report_date,
    previous_report_date,
    change_type,
    previous_worker_status,
    worker_status,
    previous_worker_type,
    worker_type,
    previous_manager_id,
    manager_id,
    previous_supervisory_organization,
    supervisory_organization,
    hire_date,
    coalesce(termination_date, previous_termination_date) as termination_date,
    termination_window_start
from classified
where change_type is not null
