-- Each worker's row in a report next to their row in the previous report: one row per
-- (worker, report date) for every report that has a previous report, covering every worker in
-- either of the two. A worker in only one of them has nulls on the other side, which is how hires
-- (no previous row) and drop-offs (no current row) show up. The first report has no rows here:
-- there is nothing to compare it with.

with report_dates as (

    select
        report_date,
        lag(report_date) over (order by report_date) as previous_report_date
    from (
        select distinct report_date
        from {{ ref('stg_workday__worker_report') }}
    ) as dates

),

report_pairs as (

    select report_date, previous_report_date
    from report_dates
    where previous_report_date is not null

),

current_rows as (

    select
        report_pairs.report_date,
        report_pairs.previous_report_date,
        report_rows.worker_id,
        report_rows.worker_status,
        report_rows.worker_type,
        report_rows.manager_id,
        report_rows.supervisory_organization,
        report_rows.hire_date,
        report_rows.termination_date,
        report_rows.is_future_hire,
        report_rows.cost_center_name
    from report_pairs
    inner join {{ ref('stg_workday__worker_report') }} as report_rows
        on report_rows.report_date = report_pairs.report_date

),

previous_rows as (

    select
        report_pairs.report_date,
        report_pairs.previous_report_date,
        report_rows.worker_id,
        report_rows.worker_status,
        report_rows.worker_type,
        report_rows.manager_id,
        report_rows.supervisory_organization,
        report_rows.hire_date,
        report_rows.termination_date,
        report_rows.is_future_hire,
        report_rows.cost_center_name
    from report_pairs
    inner join {{ ref('stg_workday__worker_report') }} as report_rows
        on report_rows.report_date = report_pairs.previous_report_date

)

select
    coalesce(cur.worker_id, prev.worker_id) as worker_id,
    coalesce(cur.report_date, prev.report_date) as report_date,
    coalesce(cur.previous_report_date, prev.previous_report_date) as previous_report_date,
    cur.worker_id is not null as is_in_report,
    prev.worker_id is not null as is_in_previous_report,

    prev.worker_status as previous_worker_status,
    cur.worker_status,
    prev.worker_type as previous_worker_type,
    cur.worker_type,
    prev.manager_id as previous_manager_id,
    cur.manager_id,
    prev.supervisory_organization as previous_supervisory_organization,
    cur.supervisory_organization,
    prev.termination_date as previous_termination_date,
    cur.termination_date,
    cur.hire_date,
    cur.is_future_hire,
    coalesce(cur.cost_center_name, prev.cost_center_name) as cost_center_name

from current_rows as cur
full join previous_rows as prev
    on prev.worker_id = cur.worker_id
    and prev.report_date = cur.report_date
