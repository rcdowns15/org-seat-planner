# Parking Lot

Good ideas, not now. Navigator adds here instead of expanding scope.

- **Seat ↔ Workday position link** (D-029) — add `position_id` to `app.seats` and reconcile by position as well as by worker. Open design questions: does a saved move change the worker's Workday position, or only the plan until HR acts? Who creates the position for a new open seat? What's the exception when the plan and HRIS disagree on a position? Back with BR-07 (multi-source reconciliation).
- **Real authentication (SSO / NextAuth)** — mock "acting as" shows the authorization logic, which is the interesting part. Back if the demo ever holds non-mock data.
- **Postgres row-level security** for leader scopes — a strong second line of defense; covered in the write-back explainer as the production answer. Back after BR-07 roles.
- **As-of-date board with pending future-dated moves** — more realistic effective dating (D-012). Back after the interview if the board feels too simple.
- **Free-form read-only SQL box** in the "Under the hood" panel — needs a locked-down role, schema allowlist and stronger limits on a public site (D-026). Back if the preset queries feel limiting.
- **Software capitalization / labor allocation** — tag squads with projects and a capitalizable %, then produce a quarterly labor-allocation report from seat history. Strong fit for finance partnership work; back after BR-05 (needs daily seat history).
- **Google Sheets round-trip** — export a squad roster to a Sheet and import edits back through the same validated write path, as a bridge from spreadsheet workflows. Back after BR-07.
- **Scenario planning** — draft a reorg as a "scenario" (a sandbox copy of seats), compare headcount and plan variance, then apply it as a batch of audited moves. Back after BR-08.
- **Engineering telemetry joined to workforce data** (e.g. issue-tracker throughput per squad) — mock feed only. Back after BR-08.
- **Operating calendar** — leadership forum and planning-cycle milestones as data with reminders. Off the core story; back if asked.
- **Python ingest in `analytics/`** instead of TypeScript (D-028) — reasonable alternative; back if the team standard is Python.
- **Vercel Cron** for nightly reseed and pipeline — GitHub Actions covers it; back if the demo gets heavy traffic.
- **Documentation-only Airflow DAG** (`orchestration/dags/seat_planner.py`, never run) — shows "what it would look like"; back after LR-03-05's `docs/orchestration.md`.
- **LLM "ask about headcount"** grounded on MetricFlow metrics — fun, but off-message for now; back after BR-06.
- **Neon branch per PR** for preview deployments — cleaner previews; back if previews start sharing state painfully.
- **Bulk moves / reorg mode** (move a whole squad) — a real feature, not needed to show write-back.
- **Approval workflow** (moves above a threshold need a second leader) — good interview talking point; back after BR-07.
- **Outbox / change-data feed** from `seat_changes` to downstream systems — covered in the explainer; build only if asked.
- **More Workday report realism** (from the 2026-11-12 data review): rehires (same `Worker_ID`, new hire date, original vs. continuous service date); FTE and time type (part-time workers, where FTE ≠ headcount, which matters for capacity and FP&A); leave type and expected return date; job profile vs. business title, job family and management level; `contract_end_date` in the typed `workday.workers` table with a "contract ending soon" exception. Back with BR-05 / BR-07.
- **Event-based Workday change feed** (business process events such as Hire, Termination and Transfer, with effective dates) instead of diffing consecutive full extracts. We diff extracts because a custom report is the common starting point and diffs catch everything, including changes made outside a business process. Events give exact effective dates and reasons. Interview answer for now; back with BR-07's API reader.
- **dbt Cloud Semantic Layer + Tableau connection** — needs paid accounts; documented as the production equivalent instead.
