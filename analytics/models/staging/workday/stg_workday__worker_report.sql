-- One row per raw report row (every report, every worker). Cleaning only: rename, cast, trim,
-- map text to enums. No joins and no history logic; that belongs in intermediate.
-- Values that fail to map become NULL on purpose, so the not_null / accepted_values tests catch them.

with raw as (

    select * from {{ source('workday', 'raw_worker_report') }}

),

cleaned as (

    select
        raw_id,
        report_date,
        source_file,
        file_sha256,
        source_row,
        loaded_at,

        upper(trim(worker_id)) as worker_id,

        -- "Last, First" -> split at the first comma; names keep any other punctuation.
        nullif(trim(split_part(worker_name, ',', 1)), '') as last_name,
        nullif(trim(substr(worker_name, strpos(worker_name, ',') + 1)), '') as first_name,

        lower(trim(work_email)) as work_email,

        case lower(trim(worker_type))
            when 'employee' then 'employee'
            when 'contingent worker' then 'contingent'
        end as worker_type,

        case lower(trim(worker_status))
            when 'active' then 'active'
            when 'on leave' then 'leave'
            when 'terminated' then 'terminated'
        end as worker_status,

        -- Dates arrive as MM/DD/YYYY text; a blank cell is an empty string.
        to_date(nullif(trim(hire_date), ''), 'MM/DD/YYYY') as hire_date,
        to_date(nullif(trim(termination_date), ''), 'MM/DD/YYYY') as termination_date,
        to_date(nullif(trim(contract_end_date), ''), 'MM/DD/YYYY') as contract_end_date,

        upper(nullif(trim(manager_id), '')) as manager_id,
        trim(job_title) as job_title,

        -- "Name (Manager Name)": org name before the final parenthesis, manager name inside it.
        trim(supervisory_organization) as supervisory_organization,
        nullif(trim(substring(trim(supervisory_organization) from '^(.*?)\s*\([^()]*\)$')), '')
            as supervisory_org_name,
        nullif(trim(substring(trim(supervisory_organization) from '\(([^()]*)\)$')), '')
            as supervisory_org_manager_name,

        upper(trim(position_id)) as position_id,
        trim(cost_center) as cost_center,
        trim(location) as location

    from raw

)

select
    *,
    -- A future-dated hire: in the report, but starts after the report date.
    hire_date > report_date as is_future_hire
from cleaned
