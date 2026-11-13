-- Grain: squad x report date. Seat counts are the live seat plan (the app keeps no seat history yet),
-- repeated for every report date; the plan is the quarter containing the report date.

with report_dates as (

    select distinct report_date
    from {{ ref('stg_workday__worker_report') }}

),

latest as (

    select max(report_date) as report_date
    from report_dates

),

squad_dates as (

    select
        squads.squad_id,
        report_dates.report_date,
        date_trunc('quarter', report_dates.report_date)::date as plan_quarter_start
    from {{ ref('dim_squads') }} as squads
    cross join report_dates

),

joined as (

    select
        squad_dates.squad_id,
        squad_dates.report_date,
        squad_dates.plan_quarter_start,
        coalesce(counts.filled_employee_seats, 0) as filled_employee_seats,
        coalesce(counts.filled_contingent_seats, 0) as filled_contingent_seats,
        coalesce(counts.open_seats, 0) as open_seats,
        coalesce(counts.backfill_seats, 0) as backfill_seats,
        coalesce(counts.offer_accepted_seats, 0) as offer_accepted_seats,
        plan.approved_seats
    from squad_dates
    left join {{ ref('int_squad_seat_counts') }} as counts on counts.squad_id = squad_dates.squad_id
    left join {{ ref('stg_app__headcount_plan') }} as plan
        on plan.squad_id = squad_dates.squad_id
        and plan.quarter_start = squad_dates.plan_quarter_start

)

select
    joined.squad_id,
    joined.report_date,
    joined.report_date = latest.report_date as is_latest_report,
    joined.plan_quarter_start,
    joined.filled_employee_seats,
    joined.filled_contingent_seats,
    joined.open_seats,
    joined.backfill_seats,
    joined.offer_accepted_seats,
    joined.approved_seats,
    joined.filled_employee_seats + joined.filled_contingent_seats + joined.offer_accepted_seats
        - joined.approved_seats as variance,
    round(
        (joined.filled_employee_seats + joined.filled_contingent_seats)::numeric
        / nullif(joined.approved_seats, 0),
        4
    ) as fill_rate
from joined
cross join latest
