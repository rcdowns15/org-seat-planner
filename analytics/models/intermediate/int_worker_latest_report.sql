-- One row per worker: their row from the most recent report they appear in. A worker missing from
-- the latest report keeps their last known row (a missing worker is an exception, not a deletion),
-- and `is_in_latest_report` says whether that row is from the newest report.

with latest_report as (

    select max(report_date) as report_date
    from {{ ref('stg_workday__worker_report') }}

),

ranked as (

    select
        *,
        row_number() over (partition by worker_id order by report_date desc) as recency_rank
    from {{ ref('stg_workday__worker_report') }}

)

select
    ranked.worker_id,
    ranked.report_date as last_seen_report_date,
    ranked.report_date = latest_report.report_date as is_in_latest_report,
    ranked.first_name,
    ranked.last_name,
    ranked.work_email,
    ranked.worker_type,
    ranked.worker_status,
    ranked.hire_date,
    ranked.termination_date,
    ranked.contract_end_date,
    ranked.manager_id,
    ranked.job_title,
    ranked.supervisory_organization,
    ranked.position_id,
    ranked.cost_center,
    ranked.location
from ranked
cross join latest_report
where ranked.recency_rank = 1
