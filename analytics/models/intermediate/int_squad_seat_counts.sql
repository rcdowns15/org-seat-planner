-- One row per squad that has seats: its seats counted by state, from the live seat plan
-- (app.seats). The plan keeps no seat history yet, so these are current counts.

select
    squad_id,
    count(*) filter (where seat_status = 'filled' and seat_type = 'employee') as filled_employee_seats,
    count(*) filter (where seat_status = 'filled' and seat_type = 'contingent') as filled_contingent_seats,
    count(*) filter (where seat_status = 'open') as open_seats,
    count(*) filter (where seat_status = 'backfill') as backfill_seats,
    count(*) filter (where seat_status = 'offer_accepted') as offer_accepted_seats,
    count(*) as total_seats
from {{ ref('stg_app__seats') }}
group by squad_id
