select
    people.worker_id,
    people.last_seen_report_date,
    people.is_in_latest_report,
    people.first_name,
    people.last_name,
    people.work_email,
    people.worker_type,
    people.worker_status,
    people.hire_date,
    people.termination_date,
    people.contract_end_date,
    people.manager_id,
    people.job_title,
    people.supervisory_organization,
    people.position_id,
    people.cost_center,
    people.location,
    seats.seat_id as current_seat_id,
    seats.squad_id as current_squad_id,
    seats.seat_type as current_seat_type,
    seats.seat_id is not null as holds_seat
from {{ ref('int_worker_latest_report') }} as people
left join {{ ref('stg_app__seats') }} as seats on seats.worker_id = people.worker_id
