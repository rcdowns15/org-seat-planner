-- Grain: exception type x subject. The latest Workday report compared with the seat plan as saved
-- now (app.seats, the same seats dim_people shows). The plan is the live plan, not the plan as of
-- the report date: this is a work queue, and a fix a leader saves clears the exception on the next
-- build. The subject is a worker, except for `hiring_gap`, whose subject is a group.
--
-- Worker checks on Workday attributes (status, type) use workers who are in the latest report.
-- A seated worker who isn't in it gets `seated_missing_from_report` instead, whatever their last
-- known status was (even a terminated worker who aged out of the report).

with latest as (

    select max(report_date) as report_date
    from {{ ref('stg_workday__worker_report') }}

),

seated as (

    select
        seats.seat_id,
        seats.squad_id,
        seats.seat_type,
        seats.worker_id,
        people.worker_status,
        people.worker_type,
        coalesce(people.is_in_latest_report, false) as is_in_latest_report,
        people.last_seen_report_date
    from {{ ref('stg_app__seats') }} as seats
    left join {{ ref('int_worker_latest_report') }} as people on people.worker_id = seats.worker_id
    where seats.worker_id is not null

),

terminated_seated as (

    select
        'terminated_seated' as exception_type,
        'error' as severity,
        worker_id as subject_id,
        worker_id,
        seat_id,
        squad_id,
        'Terminated in Workday but still holds a seat.' as detail,
        'Vacate the seat (it becomes backfill), or confirm the termination with HR.' as suggested_action
    from seated
    where is_in_latest_report
      and worker_status = 'terminated'

),

seated_missing as (

    select
        'seated_missing_from_report' as exception_type,
        'error' as severity,
        worker_id as subject_id,
        worker_id,
        seat_id,
        squad_id,
        case
            when last_seen_report_date is null then 'Holds a seat but is in no Workday report.'
            else 'Holds a seat but is not in the latest Workday report (last seen '
                || to_char(last_seen_report_date, 'YYYY-MM-DD') || ').'
        end as detail,
        'Confirm the worker''s status with HR; vacate the seat if they have left.' as suggested_action
    from seated
    where not is_in_latest_report

),

missing_without_termination as (

    select
        'missing_without_termination' as exception_type,
        'warning' as severity,
        versions.worker_id as subject_id,
        versions.worker_id,
        seats.seat_id,
        seats.squad_id,
        'In the previous report as ' || versions.previous_worker_status
            || ', missing from the latest report with no termination.' as detail,
        'Ask the HRIS team why the worker dropped from the report without a termination.'
            as suggested_action
    from {{ ref('int_worker_report_versions') }} as versions
    inner join latest on latest.report_date = versions.report_date
    left join {{ ref('stg_app__seats') }} as seats on seats.worker_id = versions.worker_id
    where versions.is_in_previous_report
      and not versions.is_in_report
      and versions.previous_worker_status in ('active', 'leave')

),

worker_type_mismatch as (

    select
        'worker_type_mismatch' as exception_type,
        'error' as severity,
        worker_id as subject_id,
        worker_id,
        seat_id,
        squad_id,
        'Workday worker type ' || worker_type || ' holds a ' || seat_type || ' seat.' as detail,
        'Move the worker to a seat of their type, or correct the worker type in Workday.'
            as suggested_action
    from seated
    where is_in_latest_report
      and worker_type <> seat_type

),

on_leave_seated as (

    select
        'on_leave_seated' as exception_type,
        'info' as severity,
        worker_id as subject_id,
        worker_id,
        seat_id,
        squad_id,
        'On leave in Workday and holds a seat.' as detail,
        'No action needed: a worker on leave keeps their seat.' as suggested_action
    from seated
    where is_in_latest_report
      and worker_status = 'leave'

),

-- Hiring gap, group level (D-029: seats aren't linked to positions). Offers are counted on the
-- live plan; future hires are matched to a group by cost center name.
group_offers as (

    select squads.group_id, count(*) as offer_accepted_seats
    from {{ ref('stg_app__seats') }} as seats
    inner join {{ ref('stg_app__squads') }} as squads on squads.squad_id = seats.squad_id
    where seats.seat_status = 'offer_accepted'
    group by squads.group_id

),

group_future_hires as (

    select groups.group_id, count(*) as future_hires
    from {{ ref('stg_workday__worker_report') }} as report
    inner join latest on latest.report_date = report.report_date
    inner join {{ ref('stg_app__groups') }} as groups on groups.group_name = report.cost_center_name
    where report.is_future_hire
    group by groups.group_id

),

hiring_gap as (

    select
        'hiring_gap' as exception_type,
        'info' as severity,
        group_offers.group_id::text as subject_id,
        null::text as worker_id,
        null::integer as seat_id,
        null::integer as squad_id,
        group_offers.offer_accepted_seats || ' offer_accepted seat(s) but '
            || coalesce(group_future_hires.future_hires, 0)
            || ' future-dated hire(s) in Workday.' as detail,
        'Check with recruiting that every accepted offer has a hire entered in Workday.'
            as suggested_action
    from group_offers
    left join group_future_hires on group_future_hires.group_id = group_offers.group_id
    where group_offers.offer_accepted_seats > coalesce(group_future_hires.future_hires, 0)

),

all_exceptions as (

    select * from terminated_seated
    union all
    select * from seated_missing
    union all
    select * from missing_without_termination
    union all
    select * from worker_type_mismatch
    union all
    select * from on_leave_seated
    union all
    select * from hiring_gap

)

select
    all_exceptions.exception_type,
    all_exceptions.subject_id,
    case when all_exceptions.exception_type = 'hiring_gap' then 'group' else 'worker' end
        as subject_type,
    all_exceptions.severity,
    latest.report_date,
    all_exceptions.worker_id,
    all_exceptions.seat_id,
    all_exceptions.squad_id,
    case
        when all_exceptions.exception_type = 'hiring_gap' then all_exceptions.subject_id::integer
        else squads.group_id
    end as group_id,
    all_exceptions.detail,
    all_exceptions.suggested_action
from all_exceptions
cross join latest
left join {{ ref('stg_app__squads') }} as squads on squads.squad_id = all_exceptions.squad_id
