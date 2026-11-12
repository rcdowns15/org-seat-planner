select
    squad_id,
    group_id,
    name as squad_name
from {{ source('app', 'squads') }}
