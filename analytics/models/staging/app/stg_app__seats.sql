select
    seat_id,
    squad_id,
    seat_type,
    status as seat_status,
    worker_id,
    version,
    updated_at,
    updated_by_leader_id
from {{ source('app', 'seats') }}
