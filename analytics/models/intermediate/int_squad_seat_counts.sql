-- One row per (squad, report date) for squads that have seats: the squad's seats counted by state
-- as of that report date (int_seat_state_as_of, D-036).

select
    squad_id,
    report_date,
    count(*) filter (where seat_status = 'filled' and seat_type = 'employee') as filled_employee_seats,
    count(*) filter (where seat_status = 'filled' and seat_type = 'contingent') as filled_contingent_seats,
    count(*) filter (where seat_status = 'open') as open_seats,
    count(*) filter (where seat_status = 'backfill') as backfill_seats,
    count(*) filter (where seat_status = 'offer_accepted') as offer_accepted_seats,
    count(*) as total_seats
from {{ ref('int_seat_state_as_of') }}
group by squad_id, report_date
