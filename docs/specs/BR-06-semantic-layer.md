# BR-06 — Semantic layer

**Status:** todo · **Depends on:** BR-05 · **Milestone:** M6 · **Target:** after the interview · **Cut line:** no

## Goal
MetricFlow semantic models and metrics in the dbt project define headcount once: `headcount`,
`headcount_incl_contingent`, `open_seats`, `total_seats`, `fill_rate`, `plan_variance`. They're
validated in CI, with documented `mf query` examples and the SQL they generate.

## Why it matters
"Headcount" turns into five different numbers in five dashboards unless it's defined once. This shows
point-in-time (non-additive) metric handling, the classic headcount trap.

## Scope
In: `dbt-metricflow`, time spine, semantic models on `fct_headcount_daily` and the plan, six metrics,
`mf validate-configs` in CI, query examples, explainer.
Out: serving metrics to BI tools. That needs the dbt Cloud Semantic Layer, and the docs say so
plainly. The app's dashboard reads the marts directly (D-018).

## Exit criteria
- `uv run mf validate-configs` passes in CI.
- Monthly `headcount` from `mf query` equals month-end values in `fct_headcount_daily` (test).
- The README shows at least three `mf query` examples with their generated SQL.

## Little rocks

### LR-06-01 · MetricFlow setup, time spine, semantic models · status: todo · depends: LR-05-03 · owner: agent · executor model: sonnet
Add `dbt-metricflow` (pinned, compatible with the dbt-core version). Time spine model. Semantic
models for `fct_headcount_daily` (entity: squad; dimensions: date, worker type, division, group) and
the headcount plan. CI step: `uv run mf validate-configs`.
- [ ] `uv run mf validate-configs` passes locally and in CI
Likely files: `analytics/models/semantic/**`, `analytics/models/marts/metricflow_time_spine.sql`, `analytics/pyproject.toml`, `.github/workflows/ci.yml`.

### LR-06-02 · Metrics with point-in-time handling · status: todo · depends: LR-06-01 · owner: agent · executor model: opus
Measures with `non_additive_dimension` (date, `window_choice: max`), so headcount and seat counts take
the end-of-period value instead of summing days. Metrics: `headcount` (employees in filled seats),
`headcount_incl_contingent`, `open_seats` (open + backfill), `total_seats`, `fill_rate` (ratio),
`plan_variance` (derived: total seats minus approved plan).
- [ ] Test script: `mf query --metrics headcount --group-by metric_time__month` equals `fct_headcount_daily` on each month-end date
- [ ] A test shows the naive daily sum would differ (the trap the metric avoids)
- [ ] `fill_rate` stays between 0 and 1 for every squad-month
Likely files: `analytics/models/semantic/metrics.yml`, `analytics/scripts/check_metrics.py`.

### LR-06-03 · Query examples and semantic-layer explainer · status: todo · depends: LR-06-02 · owner: agent · executor model: sonnet
`docs/explainers/semantic-layer.md`: what a semantic layer is for, non-additive measures, each
metric's definition, `mf query --explain` output for three examples, and an honest note on dbt Core
vs. dbt Cloud. A script reruns the examples so the doc stays current.
- [ ] Every example command in the doc runs successfully (script output in the PR)
- [ ] README updated with the examples and Built/Planned rows
Likely files: `docs/explainers/semantic-layer.md`, `analytics/scripts/render_mf_examples.py`, `README.md`.
