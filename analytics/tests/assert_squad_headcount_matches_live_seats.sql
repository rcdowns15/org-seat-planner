-- For the latest report, rpt_squad_headcount must equal live counts taken straight from app.seats
-- (the source, not the staging or intermediate models the mart is built from).
-- Returns squads whose mart counts differ from the live counts, plus a 'ALL' row if the grand
-- totals differ or the mart has no latest-report rows at all.

with live as (

    select
        squad_id,
        count(*) filter (where status = 'filled' and seat_type = 'employee') as filled_employee_seats,
        count(*) filter (where status = 'filled' and seat_type = 'contingent') as filled_contingent_seats,
        count(*) filter (where status = 'open') as open_seats,
        count(*) filter (where status = 'backfill') as backfill_seats,
        count(*) filter (where status = 'offer_accepted') as offer_accepted_seats
    from {{ source('app', 'seats') }}
    group by squad_id

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

select subject from per_squad
union all
select 'ALL' as subject
from totals
where mart_total is distinct from live_total
