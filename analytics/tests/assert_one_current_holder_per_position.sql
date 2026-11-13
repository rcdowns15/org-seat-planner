-- "One current holder per position", checked on the latest report only (D-034). The database no
-- longer enforces this: workday.workers is upsert-only, so a worker who dropped out of the extract
-- keeps an old row, and a backfill into their position must not block ingestion. Older reports and
-- terminated workers can share a position; what matters is who holds it in the latest extract.
-- Returns one row per position held by more than one non-terminated worker in the latest report.
-- Severity: error (the default for tests).

with latest as (

    select *
    from {{ ref('stg_workday__worker_report') }}
    where report_date = (select max(report_date) from {{ ref('stg_workday__worker_report') }})

)

select
    position_id,
    report_date,
    count(*) as holder_count,
    string_agg(worker_id, ', ' order by worker_id) as worker_ids
from latest
where worker_status <> 'terminated'
  and position_id is not null
group by position_id, report_date
having count(*) > 1
