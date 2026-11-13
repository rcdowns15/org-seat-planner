select
    squads.squad_id,
    squads.squad_name,
    squads.group_id,
    groups.group_name,
    groups.division_id,
    divisions.division_name
from {{ ref('stg_app__squads') }} as squads
inner join {{ ref('stg_app__groups') }} as groups on groups.group_id = squads.group_id
inner join {{ ref('stg_app__divisions') }} as divisions on divisions.division_id = groups.division_id
