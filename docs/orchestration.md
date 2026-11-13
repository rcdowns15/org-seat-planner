# Orchestration

How the Workday pipeline runs today, and which Airflow task each step would be in production
(D-020: a script plus a manual GitHub Actions workflow stand in for Airflow).

## Running it

- Locally: `pnpm run pipeline [--report <file>]`. Use `pnpm run pipeline`, not `pnpm pipeline`: pnpm 12
  has a built-in `pipeline` command that shadows a script of that name.
- On Neon: the `pipeline` workflow (`.github/workflows/pipeline.yml`, manual `workflow_dispatch`).
  It writes the mock report CSVs with `pnpm run workday:reports` (no database access, same bytes as
  the seed), then runs `pnpm run pipeline`. It never migrates or reseeds, so live edits survive.

The script (`scripts/pipeline.ts`) stops at the first failing step, prints a summary (rows ingested
per report, models built, tests passed, exception counts by type from
`analytics.rpt_reconciliation_exceptions`) and exits 1 on failure.

## Step to Airflow task

| Pipeline step today                                                          | Airflow task in production                                                                                           | Notes                                                                                                                               |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Report CSV exists in `data/workday/` (written by the seed / `workday:reports`) | `FileSensor` or an S3/GCS key sensor on the biweekly Workday report drop, with a timeout and a retry                 | The sensor only waits; it never reads. A report that never arrives fails the DAG run, which is itself an alert.                     |
| `ingestReport` for each file (validate the whole file, load raw rows, current table) | `PythonOperator`/`BashOperator` running `pnpm workday:ingest <file>`, one task per report, `retries=0` on a rejected file | Idempotent by file hash (D-028), so a retry or re-run is safe. A rejected file loads nothing and fails the task.                   |
| `uv run dbt build` in `analytics/`                                           | `BashOperator` (or Cosmos `DbtTaskGroup`) running `dbt build`, downstream of every ingest task                        | Models and tests in one command; a failing test fails the task and the DAG stops. Runs only after ingest succeeds.                  |
| Exception counts read from `rpt_reconciliation_exceptions`                   | `SQLCheckOperator`/`SQLExecuteQueryOperator` after dbt, then an alert task                                            | Counts by type are the summary today. In production, `error` severity rows above a threshold trigger the alert.                     |
| Non-zero exit / `RESULT: FAILED` in the summary                              | `on_failure_callback` (Slack or email) on the DAG                                                                    | Today the GitHub Actions run turns red instead.                                                                                     |

Not built (stays a stand-in): scheduling (the workflow is manual), a real sensor, retries and
backfills of past report dates, and paging. The step boundaries above are where those would plug in.
