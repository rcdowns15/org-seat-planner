-- The two ways to drop off a report (scripts/seed/README.md, "Report population"), after the
-- 2026-11-15 report:
--   * the aged-out workers 102005, 102006 and 102007 (terminated before the 11-15 window) are
--     `aged_out` in rpt_workday_changes and are NOT in rpt_reconciliation_exceptions;
--   * the missing worker 100878 (Active on 11-01, dropped with no termination) is `missing` in
--     rpt_workday_changes and IS in rpt_reconciliation_exceptions as `missing_without_termination`.
-- Returns one row per broken expectation. Checks only once the 11-15 report is ingested.

with report_loaded as (

    select 1 as one
    where exists (
        select 1
        from {{ ref('stg_workday__worker_report') }}
        where report_date = date '2026-11-15'
    )

),

aged_out_workers (worker_id) as (

    values ('102005'), ('102006'), ('102007')

),

problems as (

    select worker_id, 'aged-out worker is not aged_out in rpt_workday_changes' as problem
    from aged_out_workers
    where not exists (
        select 1
        from {{ ref('rpt_workday_changes') }} as changes
        where changes.worker_id = aged_out_workers.worker_id
          and changes.report_date = date '2026-11-15'
          and changes.change_type = 'aged_out'
    )

    union all

    select worker_id, 'aged-out worker is in rpt_reconciliation_exceptions' as problem
    from aged_out_workers
    where exists (
        select 1
        from {{ ref('rpt_reconciliation_exceptions') }} as exceptions
        where exceptions.worker_id = aged_out_workers.worker_id
    )

    union all

    select '100878' as worker_id, 'missing worker is not missing in rpt_workday_changes' as problem
    where not exists (
        select 1
        from {{ ref('rpt_workday_changes') }} as changes
        where changes.worker_id = '100878'
          and changes.report_date = date '2026-11-15'
          and changes.change_type = 'missing'
    )

    union all

    select '100878' as worker_id, 'missing worker is not a missing_without_termination exception'
        as problem
    where not exists (
        select 1
        from {{ ref('rpt_reconciliation_exceptions') }} as exceptions
        where exceptions.worker_id = '100878'
          and exceptions.exception_type = 'missing_without_termination'
    )

)

select problems.*
from problems
cross join report_loaded
