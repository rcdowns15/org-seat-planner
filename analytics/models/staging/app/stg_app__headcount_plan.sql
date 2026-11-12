select
    squad_id,
    quarter_start,
    approved_seats
from {{ source('app', 'headcount_plan') }}
