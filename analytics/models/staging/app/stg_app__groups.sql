select
    group_id,
    division_id,
    name as group_name
from {{ source('app', 'groups') }}
