# BR-08 — Headcount dashboard

**Status:** todo · **Depends on:** BR-05, BR-06 · **Milestone:** M8 · **Target:** after the interview · **Cut line:** no

## Goal
A `/dashboard` page shows headcount by squad and division over time, open seats, fill rate, and plan
vs. actual, read from the dbt marts with the same definitions as the MetricFlow metrics.

## Why it matters
It closes the loop: an edit on the board flows through the pipeline into the numbers leaders see.

## Scope
In: read-only mart queries, charts (shadcn charts on Recharts, D-018), freshness indicator, README v2.
Out: a semantic-layer API (needs dbt Cloud), Tableau.

## Exit criteria
- Every number on the dashboard matches a SQL query against the marts (tests).
- With an empty `analytics` schema, the page explains that the pipeline hasn't run instead of crashing.

## Little rocks

### LR-08-01 · Dashboard data access and freshness · status: todo · depends: LR-05-03 · owner: agent · executor model: sonnet
`src/server/queries/dashboard.ts`: typed, read-only queries on the marts (month-end headcount by
division and squad, open seats, fill rate, plan vs. actual). "Data as of" from the latest pipeline run.
- [ ] DB tests compare each query with a hand-written SQL check on the seed
- [ ] Empty `analytics` schema → friendly empty state (test)
Likely files: `src/server/queries/dashboard.ts`, `tests/db/dashboard.test.ts`.

### LR-08-02 · Dashboard charts · status: todo · depends: LR-08-01 · owner: agent · executor model: sonnet
Line chart of month-end headcount by division; squad table (headcount, open seats, fill rate); plan
vs. actual bars for the current quarter; filters for division and worker type.
- [ ] e2e: the headline headcount equals the DB value
- [ ] Charts have a table toggle as a text alternative
Likely files: `src/app/dashboard/page.tsx`, `src/components/dashboard/*`, `tests/e2e/dashboard.spec.ts`.

### LR-08-03 · README v2 · status: todo · depends: LR-08-02, LR-06-03, LR-07-06 · owner: agent · executor model: sonnet
Update the architecture diagram to the full system, flip Built/Planned rows, extend the demo script.
- [ ] `pnpm docs:check` passes; every Built row links to code
Likely files: `README.md`.
