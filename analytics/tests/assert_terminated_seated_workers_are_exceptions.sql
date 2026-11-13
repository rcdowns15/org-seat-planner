{{ config(severity='error') }}

-- The demo case of BR-03: every worker who holds a seat in the plan (app.seats, read from the
-- source) and whose latest Workday status is `terminated` must appear in
-- rpt_reconciliation_exceptions under the right type: `terminated_seated` when they are in the
-- latest report, `seated_missing_from_report` when they have dropped off it (aged out). Returns
-- the workers it misses. The report itself is not a failing test (a terminated worker still
-- seated is a report row); this test checks that the report catches every one.

select
    seats.worker_id,
    seats.seat_id,
    people.termination_date,
    people.is_in_latest_report
from {{ source('app', 'seats') }} as seats
inner join {{ ref('int_worker_latest_report') }} as people on people.worker_id = seats.worker_id
where people.worker_status = 'terminated'
  and not exists (
      select 1
      from {{ ref('rpt_reconciliation_exceptions') }} as exceptions
      where exceptions.worker_id = seats.worker_id
        and exceptions.exception_type = case
            when people.is_in_latest_report then 'terminated_seated'
            else 'seated_missing_from_report'
        end
  )
