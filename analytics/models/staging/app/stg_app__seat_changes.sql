select
    change_id,
    move_id,
    seat_id,
    change_type,
    worker_id,
    from_status,
    to_status,
    from_worker_id,
    to_worker_id,
    actor_leader_id,
    effective_date,
    created_at,
    reverses_change_id,
    note
from {{ source('app', 'seat_changes') }}
