select
    division_id,
    name as division_name
from {{ source('app', 'divisions') }}
