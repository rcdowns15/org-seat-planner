-- For the latest report, rpt_squad_headcount must equal live counts taken straight from app.seats
-- (the source, not the staging or intermediate models the mart is built from), provided no seat
-- change is effective after the latest report date (D-036: a future-dated change makes the live
-- seats differ from the as-of state on purpose, so the test has nothing to compare then).
-- Squads with no seats count as 0 on both sides. Returns squads whose mart counts differ from the
-- live counts, plus an 'ALL' row if the grand totals differ or the mart has no latest-report rows.

with latest as (

    select max(report_date) as report_date
    from {{ ref('rpt_squad_headcount') }}

),

comparable as (

    select 1 as one
    from latest
    where not exists (
        select 1
        from {{ source('app', 'seat_changes') }} as changes
        where changes.effective_date > latest.report_date
    )

),

live as (

    select
        squads.squad_id,
        count(seats.seat_id) filter (where seats.status = 'filled' and seats.seat_type = 'employee') as filled_employee_seats,
        count(seats.seat_id) filter (where seats.status = 'filled' and seats.seat_type = 'contingent') as filled_contingent_seats,
        count(seats.seat_id) filter (where seats.status = 'open') as open_seats,
        count(seats.seat_id) filter (where seats.status = 'backfill') as backfill_seats,
        count(seats.seat_id) filter (where seats.status = 'offer_accepted') as offer_accepted_seats
    from {{ source('app', 'squads') }} as squads
    left join {{ source('app', 'seats') }} as seats on seats.squad_id = squads.squad_id
    group by squads.squad_id

),

mart as (

    select *
    from {{ ref('rpt_squad_headcount') }}
    where is_latest_report

),

per_squad as (

    select coalesce(live.squad_id, mart.squad_id)::text as subject
    from live
    full join mart on mart.squad_id = live.squad_id
    where mart.filled_employee_seats is distinct from live.filled_employee_seats
       or mart.filled_contingent_seats is distinct from live.filled_contingent_seats
       or mart.open_seats is distinct from live.open_seats
       or mart.backfill_seats is distinct from live.backfill_seats
       or mart.offer_accepted_seats is distinct from live.offer_accepted_seats

),

totals as (

    select
        (select sum(filled_employee_seats + filled_contingent_seats + open_seats + backfill_seats + offer_accepted_seats) from mart) as mart_total,
        (select count(*) from {{ source('app', 'seats') }}) as live_total

)

select per_squad.subject
from per_squad
cross join comparable
union all
select 'ALL' as subject
from totals
cross join comparable
where mart_total is distinct from live_total
