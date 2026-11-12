select
    leader_id,
    worker_id,
    display_name,
    scope_type,
    division_id,
    group_id
from {{ source('app', 'leaders') }}
