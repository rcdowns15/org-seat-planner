# Decisions

Format: ID · date · status (proposed / accepted / superseded) · decision · why · alternatives.

New entries start as `proposed` until Rob confirms them; the navigator flips confirmed entries to
`accepted`. D-001…D-028 were all accepted by Rob on 2026-11-11.

### D-001 · 2026-11-11 · accepted (Rob, 2026-11-11) · Fictional company "Second Republic Bank", mock data only
**Why:** NDA and privacy: no real data, systems or people can appear. The name is Rob's deliberate
homage to his time at First Republic Bank (on his resume, including its collapse), and it's a story
he can tell in the interview. The homage is **the name only**: no First Republic branding, logos,
colors, products, org or team names, internal terminology, or anything about how its systems or
data worked. Nothing about the interviewing company appears at all. A bank makes people data,
approvals and audit trails feel natural.
**Alternatives:** "Northwind Financial" (the original placeholder; neutral but generic), a generic "Acme" (reads as a toy).

### D-002 · 2026-11-11 · accepted (Rob, 2026-11-11) · Next.js (App Router) + TypeScript (strict), single app at the repo root, pnpm
**Why:** first-class on Vercel. Server actions keep every mutation on the server. TypeScript end to
end (UI, server, seed, tests) means one language to explain. A single root app avoids monorepo
tooling that adds nothing at this size.
**Alternatives:** a Turborepo monorepo (overhead), Remix/SvelteKit (less conventional for this role), a separate API service (more moving parts).

### D-003 · 2026-11-11 · accepted (Rob, 2026-11-11) · Tailwind + shadcn/ui
**Why:** fast, conventional, accessible primitives (dialog, select) without a heavy component library.
**Alternatives:** MUI or Mantine (heavier, more opinionated styling).

### D-004 · 2026-11-11 · accepted (Rob, 2026-11-11) · dnd-kit for drag-and-drop, plus a keyboard "Move to…" path
**Why:** dnd-kit is the maintained, accessible React DnD library. The keyboard path covers
accessibility and gives Playwright a stable fallback.
**Alternatives:** react-beautiful-dnd (deprecated), native HTML5 DnD (poor accessibility and touch support).

### D-005 · 2026-11-11 · accepted (Rob, 2026-11-11) · Zod validation; all mutations through server actions or route handlers; client never touches the database
**Why:** one schema validates input at the trust boundary and types the result. The server is the
only place a permission check can't be bypassed.
**Alternatives:** tRPC (another layer to explain), client-side validation only (unsafe).

### D-006 · 2026-11-11 · accepted (Rob, 2026-11-11) · Drizzle ORM + drizzle-kit migrations; SQL migrations committed
**Why:** a SQL-shaped query builder with bound parameters. Generated migrations are readable SQL,
and custom migrations hold triggers and grants. Easy to explain: "it's typed SQL".
**Alternatives:** Prisma (heavier engine, less SQL-transparent), raw `pg` (no typed schema).

### D-007 · 2026-11-11 · accepted (Rob, 2026-11-11) · Postgres 16: Docker Compose locally, Neon via the Vercel integration in production; node-postgres (`pg`) driver everywhere
**Why:** the same engine everywhere. Optimistic-lock moves need real interactive transactions,
which Neon's HTTP driver doesn't support, while `pg` with Neon's pooled connection string works on
Vercel's Node runtime. The app uses the pooled URL; migrations, seed and dbt use the unpooled URL.
**Alternatives:** `@neondatabase/serverless` (two drivers to explain, no interactive transactions over HTTP), Supabase (more platform than needed).

### D-008 · 2026-11-11 · accepted (Rob, 2026-11-11) · Schemas `app`, `workday`, `analytics` (dbt adds `analytics_staging`, `analytics_intermediate`, `snapshots`)
**Why:** separates the system of record for plans (`app`), the HRIS facts (`workday`), and derived
data (`analytics`), just as they'd be separate systems in production.
**Alternatives:** separate databases (overkill for a demo).

### D-009 · 2026-11-11 · accepted (Rob, 2026-11-11) · Timeline: cut line = BR-01…BR-04 (minus undo, audit page, prod smoke) by Sun 2026-11-15 noon; BR-05…BR-08 after the interview
**Why:** four working days before the 11/16 interview. The cut line is a thin slice through every
layer (see D-027), sized so Rob can understand all of it. Specs for later work double as a roadmap.
**Alternatives:** deep write-back with no pipeline (misses half the role); everything at once (doesn't fit).

### D-010 · 2026-11-11 · accepted (Rob, 2026-11-11) · Data model: seats are first-class rows with a `version`; `seat_changes` is an append-only audit log
**Why:** headcount planning is about approved seats, filled or not. A seat row carries the state
the board shows. `seat_changes` records every change (two rows per move, sharing `move_id`). A
trigger and grants block `UPDATE`/`DELETE`, so history can't be rewritten; undo is a reversing insert.
**Alternatives:** an event-sourced model where state is derived only from events (harder to explain and query), soft deletes (history can still be edited).

### D-011 · 2026-11-11 · accepted (Rob, 2026-11-11) · Optimistic locking with a `version` column
**Why:** leaders rarely edit the same seat at once, so lock-free reads with a version check on
write fit. `UPDATE ... WHERE version = $n` affecting 0 rows → `CONFLICT` → rollback and a refresh prompt.
**Alternatives:** `SELECT ... FOR UPDATE` held across a user's think time (impossible over HTTP), last-write-wins (silently loses edits).

### D-012 · 2026-11-11 · accepted (Rob, 2026-11-11) · Effective dates: today to +90 days, no backdating; the board shows the planned state as soon as a move is saved
**Why:** this is a planning tool, so the board is the plan of record. `effective_date` is stored on
every change for analytics (when the move counts in headcount). Allowing backdating would
rewrite history that dbt has already modeled.
**Alternatives:** an as-of-date board with pending future moves (more realistic, a day of extra work; parked).

### D-013 · 2026-11-11 · accepted (Rob, 2026-11-11) · Mock auth: "acting as" leader cookie; permissions are division or group scopes enforced on the server
**Why:** shows real authorization logic without building login. The leader always comes from the
server-side cookie, never from action input.
**Alternatives:** NextAuth with demo accounts (time cost, adds nothing to the story); real SSO (parked).

### D-014 · 2026-11-11 · accepted (Rob, 2026-11-11) · Deterministic seed with @faker-js/faker and a fixed seed; ~2,000 workers across 4 divisions, 12 groups, ~180 squads
**Why:** reproducible demos and tests (a checksum proves determinism). ~2,000 people matches the
scale of the org the target role supports. **Pushback on 60 squads:** 2,000 across 60 squads is ~33
per squad, which is unrealistic and makes board columns unreadable. ~180 squads gives ~11 seats each
(~15 squads per group, which is what the board shows at once), with ~200 open/backfill seats. Org
names come from a fictional word list, not faker company names.
**Alternatives:** ~800 people across 60 squads (smaller than the real-world scale); 2,000 across 60 squads (unrealistic squads).

### D-015 · 2026-11-11 · accepted (Rob, 2026-11-11) · Workday is read-only to the app; only the ingest script and seed write it
**Why:** in production the HRIS is the source of truth and the planning tool never writes it.
Enforced in code review now, and by database roles in BR-07 (`seat_app` gets `SELECT` only on
`workday`).
**Alternatives:** let the app write status fields (blurs ownership; the exact anti-pattern to avoid).

### D-016 · 2026-11-11 · accepted (Rob, 2026-11-11) · dbt-core + dbt-postgres in `analytics/`, managed with uv; layers staging → snapshots → intermediate → marts; history from effective-dated events
**Why:** the standard analytics-engineering toolchain, and uv matches Rob's other projects.
Workday history comes from successive full report extracts (each biweekly report is a complete
picture, so SCD2 is built by comparing consecutive reports, BR-05). Snapshots only record changes
from their first run, so they demonstrate SCD2 going forward rather than carrying the backfill.
**Alternatives:** SQLMesh (less common in job descriptions), snapshots alone (no history before the first run).

### D-017 · 2026-11-11 · accepted (Rob, 2026-11-11) · MetricFlow semantic layer in the dbt project; `mf validate-configs` in CI; honest about dbt Cloud
**Why:** defines headcount once, with non-additive (end-of-period) handling. dbt Core can define,
validate and query metrics locally; serving them to BI tools needs dbt Cloud, and the docs say so.
**Alternatives:** Cube (another service to run), metrics hand-written as SQL views (no semantic contract).

### D-018 · 2026-11-11 · accepted (Rob, 2026-11-11) · The dashboard reads dbt marts directly; charts with shadcn charts (Recharts)
**Why:** no semantic-layer API without dbt Cloud. Reading marts with the same definitions is
honest and simple. shadcn charts match the UI kit.
**Alternatives:** embedding a BI tool (setup cost, auth).

### D-019 · 2026-11-11 · accepted (Rob, 2026-11-11) · Reconciliation lives in dbt (`rpt_reconciliation_exceptions`); the app shows it read-only now and gets a resolution UI in BR-07
**Why:** reconciliation is a pipeline output: it runs after each Workday refresh, is tested, and its
history can be tracked. Before the interview, the SQL panel shows it; BR-07 adds an exceptions page
with a "release seat" action that goes through the normal audited write path.
**Alternatives:** a live query in the app only (untested, duplicated logic); both from day one (duplicated logic before the interview).

### D-020 · 2026-11-11 · accepted (Rob, 2026-11-11) · Orchestration: `pnpm pipeline` (ingest → dbt build) + a manual GitHub Actions workflow, scheduled in BR-07, instead of Airflow
**Why:** two steps don't justify running Airflow. `docs/orchestration.md` maps each step to the Airflow task it would be.
**Alternatives:** Airflow in Docker (heavy), Dagster (another tool to learn this week).

### D-021 · 2026-11-11 · accepted (Rob, 2026-11-11) · Quality: ESLint + Prettier, `tsc --noEmit`, Vitest (unit + real-Postgres DB tests), Playwright smoke tests, dbt build in CI
**Why:** locking, constraints and permissions can only be proven against a real database, so DB
tests run on Docker locally and a service container in CI. `pnpm test` stays database-free and fast.
**Alternatives:** mocking the database (proves nothing about locking), pg-mem (doesn't match Postgres behavior).

### D-022 · 2026-11-11 · accepted (Rob, 2026-11-11) · Deploy: Vercel + Neon; migrations, seed and dbt run from manual GitHub workflows
**Why:** deploys on every merge. Database changes stay explicit and auditable, and Rob runs them on purpose.
**Alternatives:** running migrations in the Vercel build (couples deploys to schema changes, hard to roll back).

### D-023 · 2026-11-11 · accepted (Rob, 2026-11-11) · Demo-only actions behind a server-checked `DEMO_MODE` flag
**Why:** the public demo needs "simulate another leader's edit", "simulate Workday refresh" and
"reset demo". They must not exist in a non-demo deployment, and the simulated edit is written to
the audit log like any other change.
**Alternatives:** separate admin pages without a flag (easy to forget in production).

### D-024 · 2026-11-11 · accepted (Rob, 2026-11-11) · Version pins: Node in `.nvmrc`, pnpm in `packageManager`, Python in `analytics/.python-version`, dbt in `analytics/uv.lock`
**Why:** one place per tool (harness rule). CI reads the same pins.
**Alternatives:** versions hardcoded in workflows (drift).

### D-025 · 2026-11-11 · accepted (Rob, 2026-11-11) · Agent setup from the `code/` harness template; model pins `claude-opus-5-5` (main, navigator, orchestrator, reviewer) and `claude-sonnet-5-5` (executor)
**Why:** the harness agents are generic and read project specifics (Checks, Project rules, Domain
edge cases) from `CLAUDE.md`. Agent improvements then flow in through `harness.py update` without
merge conflicts in project-specific text.
**Alternatives:** copy project-specific agent files (they drift from the harness).

### D-026 · 2026-11-11 · accepted (Rob, 2026-11-11) · "Under the hood" SQL panel is read-only with preset queries only
**Why:** Rob asked for a simple SQL UI to demonstrate write-back. Showing the seat row's `version`,
the new `seat_changes` rows, and the exact parameterized SQL the last save ran makes the write-back
visible. Letting viewers write SQL would bypass the validation, locking and audit the demo is meant
to show, and on a public site it's a security risk. Queries run in a `READ ONLY` transaction with a
timeout and row limit. LR-03-05 adds presets for the reconciliation and headcount marts, so the
same panel shows the pipeline's output.
**Alternatives:** free-form `SELECT` box behind a read-only role (parked; more surface to secure), a writable SQL console (rejected).

### D-027 · 2026-11-11 · accepted (Rob, 2026-11-11) · Cut line is a thin slice through every layer: write-back, Workday ingestion, dbt reconciliation
**Why:** the target role weighs Workday pipelines, report transforms and HRIS-to-plan reconciliation
as heavily as the drag-and-drop tool. One working path through each layer shows range. Small enough
to understand fully by Monday; built with the seams production needs. Undo, the audit log page and
deeper history move after the interview to make room.
**Alternatives:** deep write-back only (the original cut line; misses the pipeline half of the role).

### D-028 · 2026-11-11 · accepted (Rob, 2026-11-11) · Workday ingestion: mock biweekly "custom report" CSVs → validate whole file → raw text landing table + typed current table, behind a reader interface; written in TypeScript
**Why:** this mirrors how Workday data usually arrives (scheduled custom-report extracts with
Workday-style formatting). Validate-then-load means a bad file never half-loads. Raw rows keep every
report for history and audit, and a typed current table gives the app what it needs. Hashing makes
reloads idempotent. A reader interface lets a RaaS/API reader (BR-07) replace the CSV reader without
changing anything downstream. TypeScript keeps one language across app, seed and ingest; dbt holds
the transforms in SQL.
**Alternatives:** seed writes typed Workday tables directly (no ingestion story); Python ingest in `analytics/` (a second language for the same team; reasonable, parked).

### D-029 · 2026-11-11 · accepted (Rob, 2026-11-11) · Workday report carries Position_ID, Cost_Center and Location; seats are not linked to Workday positions before the interview
**Why:** these are standard columns on a real Workday worker report, and a reviewer who knows
Workday would notice them missing. They're cheap to add (LR-01-06 schema, LR-01-07 seed, LR-03-02
staging casts) and give the pipeline more real cleaning to do. Linking `app.seats` to Workday
positions is a different kind of change: it needs answers to when a move changes a Workday position,
who creates the position behind a new open seat, and how to reconcile when the plan and HRIS disagree
on a position. That's a new reconciliation dimension on the critical path of a 4-day timeline, so
it's parked (see `PARKING_LOT.md`, back with BR-07). Until then, seats match Workday by `worker_id`
only, and the README says so.
**Alternatives:** no new columns (less realistic report); full seat ↔ position link now (too much
design and risk before the interview).
**Amended by D-034 (2026-11-12):** the `workers_position_id_active_key` partial unique index is
relaxed by LR-03-06; one-holder-per-position is checked on the latest report instead. The columns
and the parked seat ↔ position link are unchanged.

### D-030 · 2026-11-12 · accepted (Rob, 2026-11-12, merging PR #4) · Leader scope stored as `division_id` / `group_id` with a CHECK, not a single `scope_id`
**Why:** a single `scope_id` would have to point at either `app.divisions` or `app.groups`
depending on `scope_type`, so it couldn't have a foreign key and the database couldn't stop a
leader being scoped to a division or group that doesn't exist. With two nullable columns, each one
gets a real foreign key, and a CHECK enforces that exactly the column matching `scope_type` is set.
The permission rule in D-013 is unchanged. This came from the LR-01-06 executor, and the reviewer
judged it sound.
**Alternatives:** single `scope_id` as originally specced (no referential integrity); a separate
`leader_scopes` table (more flexible, like multiple scopes per leader, but nothing in the plan needs it).

### D-031 · 2026-11-12 · accepted (Rob, 2026-11-12) · Mock Workday reports model real report behavior, not just formats
**Why:** a review of the planned report found the formats realistic but the behavior thin, and the
behavior is what reconciliation logic depends on. Adopted: (1) a population rule (active, on leave,
plus terminated within 30 days), so a worker dropping off can be legitimate (`aged_out`) or an
exception (missing with no termination); (2) future-dated hires, which give a group-level hiring
check against `offer_accepted` seats without a TA feed; (3) supervisory orgs shown as
`Name (Manager)` and kept separate from squads; (4) separate employee and contingent `Worker_ID`
schemes plus a `Contract_End_Date` column (CSV only for now); (5) BOM, CRLF, quoted names with
accents and apostrophes. These are seed, validation, staging and exceptions changes inside
LR-01-07, LR-03-01, LR-03-02 and LR-03-04. No new little rock, and the cut line is unchanged.
Rehires, FTE, leave types, job profile detail, and event-based change feeds are parked.
**Alternatives:** formats only (reconciliation results would be naive about filtered reports);
the full set including parked items (too much for the timeline).

### D-032 · 2026-11-12 · accepted (Rob, 2026-11-12) · LR-01-07 seed layout choices: layout signed off, leaders keep group cost centers for now, `<group> Team <n>` org names
**Decision:** (1) Rob's merge of PR #5 counts as his approval of the 14-column worker report
layout in `scripts/seed/README.md`. (2) The head of engineering and the division VPs stay charged
to a squad group's cost center (e.g. `CC-1010 Digital Channels`). This is a known simplification:
it's documented in the seed README and parked, to be raised again after the interview. (3) Squad
managers' supervisory orgs are named `<group> Team <n>`, as the executor chose.
**Why:** (1) The PR review was the planned sign-off point. (2) Leaders usually sit in a
leadership cost center, but changing it now would change the seed checksum and both reports just
before BR-03 builds on them. The flaw is small and makes a good interview talking point if it's
documented honestly. (3) It's a common Workday naming pattern for team orgs, and it's fictional.
**Alternatives:** add a leadership cost center now (e.g. `CC-1000 Engineering Leadership`;
reopens a merged seed on the critical path); name orgs after squads (wrong: D-031 keeps
supervisory orgs separate from squads).

### D-033 · 2026-11-12 · accepted (Rob, 2026-11-12) · No TA feed before the interview; LR-07-04 stays after the cut line
**Decision:** the Talent Acquisition offers feed stays in LR-07-04 (BR-07, after the interview).
Before the interview, hiring is covered by D-031's hiring-gap exception (`offer_accepted` seats vs.
future-dated Workday hires, matched by group). The README roadmap (LR-04-02) and the pipeline
explainer (LR-04-03) present the TA feed as the next step after that check.
**Why:** a TA slice touches the seed, ingestion, staging and exceptions, and could only start after
LR-03-04 on an already full Saturday. Pulling it above the protected cut line would push something
else out (first candidate: LR-02-08's "Last save: SQL executed"). The hiring-gap check already
tells the hiring story without a new source.
**Alternatives:** pull in a thin TA slice (just the "TA start date passed, no Workday hire"
exception) and drop "Last save: SQL executed" below the cut line; park TA entirely (not useful,
since it's already specced).

### D-034 · 2026-11-12 · accepted (Rob, 2026-11-12) · LR-03-06 goes above the cut line with no drop now; a Saturday 18:00 tripwire drops "Last save: SQL executed" if we're behind
**Decision:** LR-03-06 (stop a position backfill from wedging ingestion) moves above the cut line,
and nothing is dropped now. Tripwire: at **Sat 11/14 18:00**, if LR-02-08 or LR-03-04 isn't
merged, the "Last save: SQL executed" part of LR-02-08 moves below the cut line with no further
discussion (drop-order item 1). LR-03-06 relaxes the D-029 partial unique index
`workers_position_id_active_key` in a new migration. "One current holder per position" moves from
an ingest-time constraint to a check on the latest report (dbt test or reconciliation exception).
**Why:** a real Workday extract can drop a worker who isn't terminated while their position is
backfilled. Today that rejects every later report, which contradicts "a missing worker is an
exception, not a blocker". Rob wants the pipeline correct for this case before the interview, not
just documented. The cut line is protected, but we're about half a day ahead of plan, so the
tripwire names the item that gives way without cutting it early. Cost: one PR, about 0.75 Rob-hours.
**Alternatives:** fix after the interview and document the limitation (navigator's
recommendation: no added load); drop "Last save: SQL executed" now; drop LR-02-06 seat history.

### D-035 · 2026-11-12 · accepted (Rob, 2026-11-12) · dbt-core 1.10 and dbt-postgres 1.9 on Python 3.12
**Decision:** `analytics/pyproject.toml` is the one place dbt versions are pinned (`dbt-core==1.10.*`,
`dbt-postgres==1.9.*`, `requires-python >=3.12,<3.13`). `uv.lock` locks the exact versions, and
`analytics/.python-version` matches. Chosen by the LR-03-02 executor (PR #10).
**Why:** these were the current stable versions at build time. Since dbt 1.8 the adapter versions
separately from core, so different minor versions are expected. Pinning to the minor version keeps
local and CI identical. **To check at BR-06:** whether `dbt-metricflow` works with dbt-core 1.10;
pin it to match.
**Alternatives:** dbt Fusion (not Postgres-ready for this project; would need its own decision).

### D-036 · 2026-11-13 · accepted (Rob, 2026-11-13) · Squad headcount is rebuilt as of each report date from `app.seat_changes`
**Decision:** `rpt_squad_headcount` (LR-03-03) computes seat state as of each report date: start
from live `app.seats` and rewind every change with `effective_date` after the report date using its
`from_*` columns, ordered by `(effective_date, change_id)`. The live-count test is restated: latest
report totals equal live `app.seats` counts when no change is effective after the report date.
**Why:** headcount is a point-in-time measure (project rule). Stamping today's counts on every
report date makes past rows wrong, counts future-dated moves early, and can fail
`squad_not_over_plan` falsely across a quarter boundary. The append-only audit log already holds
the history, so using it costs one intermediate model, and it shows why the audit trail exists.
**Alternatives:** keep live counts and limit `squad_not_over_plan` to the latest report (faster,
but publishes known-wrong history).

### D-037 · 2026-11-13 · accepted (Rob, 2026-11-13); part (1) superseded by D-038 (widened to every writer) · The move service rejects out-of-order effective dates (LR-02-10); stale versions are checked right after permission
**Decision:** (1) `moveWorker` rejects a move whose effective date is earlier than the latest
pending change on the worker, the source seat or the target seat
(`EFFECTIVE_DATE_BEFORE_PENDING_CHANGE`). It's built as LR-02-10, split from LR-02-03 so #11 can
merge without another fix round. It's a missing validation, not new scope, so the cut line doesn't
move. dbt orders changes by `(effective_date, change_id)` and has a warn-level backstop test.
(2) In LR-02-03, `CONFLICT` (stale version) is checked right after `FORBIDDEN`, before the worker,
seat and date checks (the LR-02-03 review P2 fix).
**Why:** (1) "a worker holds at most one seat on every date" must hold in the data, not only in
dbt's reading of it. Correctness lives on the server and in the database. (2) After the version
check, the domain checks run on exactly the rows the update will write; checking stale rows was the
review's race. The cost is a stale-board user with a bad date seeing "refresh" before the date
error.
**Alternatives:** (1) order by save time in dbt with no server rule (the invariant holds only in
analytics); fold the rule into #11 (delays LR-02-04 and LR-02-08 toward the tripwire). (2) keep
`CONFLICT` last (domain checks would validate rows that may already have changed).

### D-038 · 2026-11-13 · accepted (Rob, 2026-11-13) · No `seat_changes` row may be dated earlier than the latest change on its seat or worker (widens D-037 part 1)
**Decision:** every code path that inserts into `app.seat_changes` (the move service, LR-02-05's
"simulate another leader's edit", LR-02-07's undo, and any future writer) rejects or dates the row
so that its `effective_date` is never earlier than the latest `effective_date` already recorded for
the same seat or worker. An equal date is allowed. It becomes a project rule the reviewer checks on
every little rock. The criteria the orchestrator added to LR-02-05 and LR-02-07 implement it, and
LR-02-10's `EFFECTIVE_DATE_BEFORE_PENDING_CHANGE` stays the move service's code.
**Why:** dbt rebuilds seat state as of each report date (D-036) and ordering by
`(effective_date, change_id)` is only correct if no writer backdates. The LR-03-03 review 2 found
that a likely demo sequence (move someone, then simulate an edit on that seat) would break the
as-of seat state and `no_double_seating`. One rule for all writers beats per-feature criteria
that a new writer could miss.
**Alternatives:** keep the criteria per little rock with no rule (a future writer could miss it);
order by save time in dbt (the invariant would hold only in analytics, see D-037).
**Timeline impact:** none. No new little rock, and the criteria already exist.
