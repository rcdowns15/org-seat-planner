-- One row per raw report row (every report, every worker). Cleaning only: rename, cast, trim,
-- map text to enums. No joins and no history logic; that belongs in intermediate.
-- Values that fail to map become NULL on purpose, so the not_null / accepted_values tests catch them.
-- Trimming matches the loader (scripts/ingest/load.ts): whitespace is trimmed with clean_text,
-- IDs and email are not re-cased, blank text becomes NULL.

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

        nullif({{ clean_text('worker_id') }}, '') as worker_id,

        -- "Last, First" -> split at the first comma; names keep any other punctuation.
        nullif({{ clean_text("split_part(worker_name, ',', 1)") }}, '') as last_name,
        nullif({{ clean_text("substr(worker_name, strpos(worker_name, ',') + 1)") }}, '') as first_name,

        nullif({{ clean_text('work_email') }}, '') as work_email,

        case {{ clean_text('worker_type') }}
            when 'Employee' then 'employee'
            when 'Contingent Worker' then 'contingent'
        end as worker_type,

        case {{ clean_text('worker_status') }}
            when 'Active' then 'active'
            when 'On Leave' then 'leave'
            when 'Terminated' then 'terminated'
        end as worker_status,

        -- Dates arrive as MM/DD/YYYY text; a blank cell is an empty string.
        to_date(nullif({{ clean_text('hire_date') }}, ''), 'MM/DD/YYYY') as hire_date,
        to_date(nullif({{ clean_text('termination_date') }}, ''), 'MM/DD/YYYY') as termination_date,
        to_date(nullif({{ clean_text('contract_end_date') }}, ''), 'MM/DD/YYYY') as contract_end_date,

        nullif({{ clean_text('manager_id') }}, '') as manager_id,
        nullif({{ clean_text('job_title') }}, '') as job_title,
        nullif({{ clean_text('supervisory_organization') }}, '') as supervisory_organization,
        nullif({{ clean_text('position_id') }}, '') as position_id,
        nullif({{ clean_text('cost_center') }}, '') as cost_center,
        nullif({{ clean_text('location') }}, '') as location

    from raw

)

select
    *,
    -- "Name (Manager Name)": org name before the final parenthesis, manager name inside it.
    nullif({{ clean_text("substring(supervisory_organization from '^(.*?)\s*\([^()]*\)$')") }}, '')
        as supervisory_org_name,
    nullif({{ clean_text("substring(supervisory_organization from '\(([^()]*)\)$')") }}, '')
        as supervisory_org_manager_name,
    -- A future-dated hire: in the report, but starts after the report date.
    hire_date > report_date as is_future_hire
from cleaned
