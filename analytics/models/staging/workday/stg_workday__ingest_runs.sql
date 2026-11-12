select
    run_id,
    source_file,
    file_sha256,
    report_date,
    row_count,
    status,
    rejection_reasons,
    ran_at
from {{ source('workday', 'ingest_runs') }}
