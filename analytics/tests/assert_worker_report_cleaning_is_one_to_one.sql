-- Proves the cleaning: every raw report row maps to exactly one staged row, and no staged row
-- has a null status, type or hire date (a value that failed to map would be null).
-- Returns the offending raw rows; the test passes when it returns nothing (also on an empty table).

with staged_counts as (

    select raw_id, count(*) as staged_rows
    from {{ ref('stg_workday__worker_report') }}
    group by raw_id

)

select
    raw.raw_id,
    raw.worker_id,
    raw.worker_status as raw_status,
    raw.worker_type as raw_type,
    coalesce(staged_counts.staged_rows, 0) as staged_rows
from {{ source('workday', 'raw_worker_report') }} as raw
left join staged_counts on staged_counts.raw_id = raw.raw_id
left join {{ ref('stg_workday__worker_report') }} as staged on staged.raw_id = raw.raw_id
where coalesce(staged_counts.staged_rows, 0) <> 1
   or staged.worker_status is null
   or staged.worker_type is null
   or staged.hire_date is null

union all

-- Staged rows with no raw row behind them.
select
    staged.raw_id,
    staged.worker_id,
    null,
    null,
    0
from {{ ref('stg_workday__worker_report') }} as staged
where not exists (
    select 1 from {{ source('workday', 'raw_worker_report') }} as raw where raw.raw_id = staged.raw_id
)
