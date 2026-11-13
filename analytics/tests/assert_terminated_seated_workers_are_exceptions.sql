{{ config(severity='error') }}

-- The demo case of BR-03: every worker who holds a seat in the plan (app.seats, read from the
-- source) and whose latest Workday status is `terminated` must appear in
-- rpt_reconciliation_exceptions, under any exception type. Returns the workers it misses.
-- The report itself is not a failing test (a terminated worker still seated is a report row);
-- this test checks that the report catches every one.

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
  )
