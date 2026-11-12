# Data model

The Postgres schemas the app owns, as created by the Drizzle migrations in `db/migrations/`
(schema source: `db/schema/app.ts`, `db/schema/workday.ts`). dbt's `analytics*` schemas are
documented in the dbt project (BR-04 onward).

`tests/db/data-model-doc.test.ts` compares this file with `information_schema` after migrating:
every table and column in `app` and `workday` must have a row below, and every row below must
exist. Change the schema and this file in the same little rock.

## Schemas

| Schema | Owner | Purpose |
|---|---|---|
| `app` | the seat planner | The leaders' plan: org hierarchy, seats, audit log, approved headcount (D-008, D-010). |
| `workday` | ingest and seed scripts only | The mock HRIS. Read-only to the app (D-015). |
| `analytics` | dbt | Marts the dashboard reads. Created empty by the first migration. |
| `drizzle` | drizzle migrator | `__drizzle_migrations`: which migrations have run. Not app data. |

## Tables at a glance

| Table | One line |
|---|---|
| `app.divisions` | Top level of the org hierarchy. |
| `app.groups` | Middle level: a group belongs to one division. |
| `app.squads` | Bottom level: a squad belongs to one group and owns seats. |
| `app.leaders` | Engineering leaders who edit the plan, each scoped to one division or one group. |
| `app.seats` | One approved seat in a squad, filled or not; the row the board shows, with an optimistic-lock `version`. |
| `app.seat_changes` | Append-only audit log: one row per seat change; a move is two rows sharing `move_id`. |
| `app.headcount_plan` | Approved seat count per squad per quarter (the plan the HRIS is reconciled against). |
| `workday.workers` | Current typed view of Workday: one row per worker from the latest accepted report. |

## ER diagram

```mermaid
erDiagram
    divisions ||--o{ groups : contains
    groups ||--o{ squads : contains
    squads ||--o{ seats : owns
    squads ||--o{ headcount_plan : "planned per quarter"
    divisions |o--o{ leaders : "scope (division leader)"
    groups |o--o{ leaders : "scope (group leader)"
    seats ||--o{ seat_changes : "history of"
    leaders ||--o{ seat_changes : "acted"
    leaders |o--o{ seats : "last updated"
    seat_changes |o--o| seat_changes : "reverses"
    workers |o..o| seats : "worker_id (no FK)"
    workers |o..o| leaders : "worker_id (no FK)"

    divisions {
        int division_id PK
        text name UK
    }
    groups {
        int group_id PK
        int division_id FK
        text name UK
    }
    squads {
        int squad_id PK
        int group_id FK
        text name
    }
    leaders {
        int leader_id PK
        text worker_id UK
        text display_name
        text scope_type
        int division_id FK
        int group_id FK
    }
    seats {
        int seat_id PK
        int squad_id FK
        text seat_type
        text status
        text worker_id
        int version
        timestamptz updated_at
        int updated_by_leader_id FK
    }
    seat_changes {
        bigint change_id PK
        uuid move_id
        int seat_id FK
        text change_type
        text worker_id
        text from_status
        text to_status
        text from_worker_id
        text to_worker_id
        int actor_leader_id FK
        date effective_date
        timestamptz created_at
        bigint reverses_change_id FK
        text note
    }
    headcount_plan {
        int squad_id PK
        date quarter_start PK
        int approved_seats
    }
    workers {
        text worker_id PK
        text first_name
        text last_name
        text email
        text worker_type
        text status
        date hire_date
        date termination_date
        text manager_worker_id
        text job_title
        text supervisory_org
        text position_id
        text cost_center
        text location
        date as_of_report_date
        timestamptz updated_at
    }
```

Dotted lines are logical links with no foreign key (see "Design choices").

## Tables

### `app.divisions`
Top level of the org hierarchy.

| Column | Type | Null | Notes |
|---|---|---|---|
| `division_id` | integer identity | no | PK |
| `name` | text | no | unique |

### `app.groups`
Middle level of the hierarchy; a group belongs to one division.

| Column | Type | Null | Notes |
|---|---|---|---|
| `group_id` | integer identity | no | PK |
| `division_id` | integer | no | FK → `app.divisions` |
| `name` | text | no | unique |

### `app.squads`
Bottom level of the hierarchy; seats belong to squads.

| Column | Type | Null | Notes |
|---|---|---|---|
| `squad_id` | integer identity | no | PK |
| `group_id` | integer | no | FK → `app.groups` |
| `name` | text | no | unique within its group |

### `app.leaders`
Engineering leaders who edit the plan. A division leader can edit every squad in the division; a
group leader only the group's squads.

| Column | Type | Null | Notes |
|---|---|---|---|
| `leader_id` | integer identity | no | PK |
| `worker_id` | text | no | unique; the leader's Workday worker id (no FK) |
| `display_name` | text | no | |
| `scope_type` | text | no | `division` \| `group` |
| `division_id` | integer | yes | FK → `app.divisions`; set only when `scope_type = 'division'` |
| `group_id` | integer | yes | FK → `app.groups`; set only when `scope_type = 'group'` |

### `app.seats`
One approved seat in a squad. Seats are never deleted; a vacated seat becomes `backfill`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `seat_id` | integer identity | no | PK |
| `squad_id` | integer | no | FK → `app.squads` |
| `seat_type` | text | no | `employee` \| `contingent` |
| `status` | text | no | `filled` \| `open` \| `backfill` \| `offer_accepted` |
| `worker_id` | text | yes | set if and only if `status = 'filled'`; unique when not null (no double-seating); no FK |
| `version` | integer | no | default 0, never negative; +1 on every update (optimistic lock, D-011) |
| `updated_at` | timestamptz | no | default `now()` |
| `updated_by_leader_id` | integer | yes | FK → `app.leaders`; null for seeded rows |

No position column: seats match Workday by `worker_id` only (D-029).

### `app.seat_changes`
Append-only audit log (D-010). A move writes two rows (`move_out` on the source seat, `move_in` on
the target) sharing a `move_id`; undo inserts reversing rows. Rows are never updated or deleted.

| Column | Type | Null | Notes |
|---|---|---|---|
| `change_id` | bigint identity | no | PK |
| `move_id` | uuid | yes | shared by the two rows of a move; required for `move_out` / `move_in` |
| `seat_id` | integer | no | FK → `app.seats` |
| `change_type` | text | no | `move_out` \| `move_in` \| `fill` \| `vacate` \| `reserve` \| `release` \| `undo` \| `demo_touch` |
| `worker_id` | text | yes | the worker the change is about (mover, hire, leaver); no FK |
| `from_status` | text | no | seat status before (same values as `app.seats.status`) |
| `to_status` | text | no | seat status after |
| `from_worker_id` | text | yes | seat's worker before; set if and only if `from_status = 'filled'` |
| `to_worker_id` | text | yes | seat's worker after; set if and only if `to_status = 'filled'` |
| `actor_leader_id` | integer | no | FK → `app.leaders`; who made the change |
| `effective_date` | date | no | when the change takes effect (today to +90 days in the app, D-012) |
| `created_at` | timestamptz | no | default `now()`; when it was saved |
| `reverses_change_id` | bigint | yes | FK → `app.seat_changes`; set if and only if `change_type = 'undo'`; unique, so a change is reversed at most once |
| `note` | text | yes | free text |

Change types: `move_out` / `move_in` (the two halves of a move), `fill` (a worker takes an open,
backfill or reserved seat, e.g. a new hire), `vacate` (a worker leaves a seat, e.g. a termination),
`reserve` (an accepted offer holds a seat), `release` (a leader frees a terminated worker's seat,
BR-07), `undo` (a reversing row), `demo_touch` ("simulate another leader's edit", BR-02).

### `app.headcount_plan`
Approved seats per squad per quarter.

| Column | Type | Null | Notes |
|---|---|---|---|
| `squad_id` | integer | no | PK part; FK → `app.squads` |
| `quarter_start` | date | no | PK part; must be Jan 1, Apr 1, Jul 1 or Oct 1 |
| `approved_seats` | integer | no | never negative |

### `workday.workers`
The current, typed view of Workday: one row per worker from the latest accepted report. Written only
by `scripts/ingest/` and `scripts/seed/` (D-015). BR-03 adds the raw report landing tables.

| Column | Type | Null | Notes |
|---|---|---|---|
| `worker_id` | text | no | PK; Workday's `Worker_ID`: six digits for employees (`104217`), `C-` plus five digits for contingent workers (`C-04512`) (D-031) |
| `first_name` | text | no | |
| `last_name` | text | no | |
| `email` | text | no | |
| `worker_type` | text | no | `employee` \| `contingent` |
| `status` | text | no | `active` \| `leave` \| `terminated` |
| `hire_date` | date | no | |
| `termination_date` | date | yes | |
| `manager_worker_id` | text | yes | the manager's `worker_id`; no FK (a manager can be missing from an extract) |
| `job_title` | text | no | |
| `supervisory_org` | text | no | as in the report: `<org name> (<manager full name>)`; follows the manager tree, not squads (D-031) |
| `position_id` | text | no | Workday position (D-029); unique among non-terminated workers; not linked to `app.seats` |
| `cost_center` | text | no | D-029 |
| `location` | text | no | D-029 |
| `as_of_report_date` | date | no | date of the report this row came from |
| `updated_at` | timestamptz | no | default `now()`; when this row was loaded |

## Design choices

- **Enums are `text` + `CHECK`**, not Postgres enum types (`db/schema/checks.ts`). A bad value is a
  `check_violation` (SQLSTATE `23514`) naming the constraint; adding a value is a one-line
  constraint swap in a migration; and dbt reads plain text, so `accepted_values` tests mirror the
  same lists.
- **Integer identity keys** (`GENERATED ALWAYS AS IDENTITY`) on `app` tables. Worker ids are text
  because they come from Workday.
- **No foreign keys from `app` to `workday`.** `app.seats.worker_id`, `app.seat_changes.*worker_id`
  and `app.leaders.worker_id` are plain text. Ingest (BR-03) replaces `workday` rows from each full
  report, a worker can vanish from a report or be terminated while still seated, and those are
  reconciliation exceptions for dbt to flag. An FK would make ingest fail (or cascade into the
  plan) instead, and would couple two systems that are separate in production (D-008).
- **Leader scope as two FK columns.** The spec's polymorphic `scope_id` can't carry a foreign key,
  so a leader has `division_id` or `group_id`, and a `CHECK` makes exactly the one matching
  `scope_type` non-null.
- **`workday.workers` doesn't second-guess the HRIS.** Beyond types, enums and the position rule,
  it accepts what the report says; dbt reports oddities instead of the loader rejecting them.
- **Append-only audit log.** A custom migration (`db/migrations/0002_seat_changes_append_only.sql`)
  adds a `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger that always raises, and a
  `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger that raises unless the transaction has run
  `SET LOCAL app.allow_seat_changes_reset = 'on'`.
  **How the seed resets the table (LR-01-07):** in one transaction, `SET LOCAL
  app.allow_seat_changes_reset = 'on'`, then `TRUNCATE` the `app` and `workday` tables
  (`RESTART IDENTITY`), then insert. `SET LOCAL` ends with the transaction, so nothing else ever
  runs with the escape hatch on. The triggers stop accidents; BR-07's grants are the access control.
- **Schemas come from migrations.** `0000_create_schemas.sql` (custom) runs
  `CREATE SCHEMA IF NOT EXISTS` for `app`, `workday` and `analytics`, so a new Neon database needs
  no setup and the local Docker volume (whose init script already made them) is unaffected. Its
  drizzle-kit snapshot records `app` and `workday`, so the generated `0001_initial_tables.sql`
  doesn't try to create them again.
- **Migration runner.** `pnpm db:migrate` runs `scripts/db/migrate.ts`, which applies pending
  migrations with `drizzle-orm/node-postgres/migrator` using `DATABASE_URL_UNPOOLED`, falling back
  to `DATABASE_URL` (D-007). It prints only counts and error codes, never the connection string.
  `pnpm test:db` runs the same function first (Vitest `globalSetup`).
