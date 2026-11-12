-- Ties the SQL cleaning in staging to the loader's TypeScript cleaning (scripts/ingest/load.ts,
-- toWorker): workday.workers must equal the latest report's staged rows, column by column.
-- Returns latest-report staged workers that are missing from workers, and rows where any shared
-- column differs. Blank text is null in staging and '' in workers, so compare through nullif.
-- Column names: email = work_email, status = worker_status, manager_worker_id = manager_id,
-- supervisory_org = supervisory_organization.

with latest as (

    select *
    from {{ ref('stg_workday__worker_report') }}
    where report_date = (select max(report_date) from {{ ref('stg_workday__worker_report') }})

)

select
    latest.worker_id,
    latest.report_date,
    workers.worker_id is null as missing_from_workers
from latest
left join {{ source('workday', 'workers') }} as workers on workers.worker_id = latest.worker_id
where workers.worker_id is null
   or workers.first_name is distinct from latest.first_name
   or workers.last_name is distinct from latest.last_name
   or nullif(workers.email, '') is distinct from latest.work_email
   or workers.worker_type is distinct from latest.worker_type
   or workers.status is distinct from latest.worker_status
   or workers.hire_date is distinct from latest.hire_date
   or workers.termination_date is distinct from latest.termination_date
   or workers.manager_worker_id is distinct from latest.manager_id
   or nullif(workers.job_title, '') is distinct from latest.job_title
   or nullif(workers.supervisory_org, '') is distinct from latest.supervisory_organization
   or nullif(workers.position_id, '') is distinct from latest.position_id
   or nullif(workers.cost_center, '') is distinct from latest.cost_center
   or nullif(workers.location, '') is distinct from latest.location
