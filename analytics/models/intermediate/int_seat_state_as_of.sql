-- Every seat's state as of each report date: one row per (seat, report date). D-036.
--
-- app.seats is the live state, and it already includes every saved change, even ones whose
-- effective date is still in the future. To get the state on a report date, rewind every change
-- with an effective date after the report date, newest first, using its from_* columns.
-- Rewinding a chain of changes ends at the from_* state of the earliest change in the chain, so
-- this takes that earliest change per seat and report date, ordered by (effective_date, change_id).
-- Seats with no later change keep their live state. A seat's squad and type never change.

with report_dates as (

    select distinct report_date
    from {{ ref('stg_workday__worker_report') }}

),

seat_dates as (

    select
        seats.seat_id,
        seats.squad_id,
        seats.seat_type,
        seats.seat_status as live_status,
        seats.worker_id as live_worker_id,
        report_dates.report_date
    from {{ ref('stg_app__seats') }} as seats
    cross join report_dates

),

earliest_later_change as (

    select distinct on (seat_dates.seat_id, seat_dates.report_date)
        seat_dates.seat_id,
        seat_dates.report_date,
        changes.from_status,
        changes.from_worker_id
    from seat_dates
    inner join {{ ref('stg_app__seat_changes') }} as changes
        on changes.seat_id = seat_dates.seat_id
        and changes.effective_date > seat_dates.report_date
    order by seat_dates.seat_id, seat_dates.report_date, changes.effective_date, changes.change_id

)

select
    seat_dates.seat_id,
    seat_dates.squad_id,
    seat_dates.seat_type,
    seat_dates.report_date,
    coalesce(earliest_later_change.from_status, seat_dates.live_status) as seat_status,
    case
        when earliest_later_change.seat_id is not null then earliest_later_change.from_worker_id
        else seat_dates.live_worker_id
    end as worker_id
from seat_dates
left join earliest_later_change
    on earliest_later_change.seat_id = seat_dates.seat_id
    and earliest_later_change.report_date = seat_dates.report_date
