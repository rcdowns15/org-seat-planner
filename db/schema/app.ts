import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { inList } from "./checks";

// The `app` schema is the seat planner's system of record (D-008, D-010).
export const app = pgSchema("app");

// Enum values (text + CHECK; see db/schema/checks.ts for why).
export const LEADER_SCOPE_TYPES = ["division", "group"] as const;
export const SEAT_TYPES = ["employee", "contingent"] as const;
export const SEAT_STATUSES = ["filled", "open", "backfill", "offer_accepted"] as const;
// move_out/move_in: the two rows of a move (shared move_id). fill: an open/backfill/offer seat
// gets a worker (e.g. a new hire). vacate: a worker leaves a seat (e.g. a termination). reserve: an
// accepted offer holds a seat. release: a leader frees a terminated worker's seat (BR-07).
// undo: a reversing row (reverses_change_id). demo_touch: "simulate another leader's edit" (BR-02).
export const CHANGE_TYPES = [
  "move_out",
  "move_in",
  "fill",
  "vacate",
  "reserve",
  "release",
  "undo",
  "demo_touch",
] as const;

// Keys: app tables use integer identity keys (`generated always`, so nothing can insert a
// clashing id). Worker ids are text because they come from Workday.

export const divisions = app.table("divisions", {
  divisionId: integer("division_id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
});

export const groups = app.table("groups", {
  groupId: integer("group_id").primaryKey().generatedAlwaysAsIdentity(),
  divisionId: integer("division_id")
    .notNull()
    .references(() => divisions.divisionId),
  name: text("name").notNull().unique(),
});

export const squads = app.table(
  "squads",
  {
    squadId: integer("squad_id").primaryKey().generatedAlwaysAsIdentity(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.groupId),
    name: text("name").notNull(),
  },
  (t) => [unique("squads_group_id_name_key").on(t.groupId, t.name)],
);

// A leader's edit scope is one division or one group. Instead of one polymorphic `scope_id`
// (which no foreign key can check), the scope is `division_id` or `group_id`, and a CHECK makes
// exactly the one matching `scope_type` non-null.
// worker_id has no FK to workday.workers: see the note on app.seats.
export const leaders = app.table(
  "leaders",
  {
    leaderId: integer("leader_id").primaryKey().generatedAlwaysAsIdentity(),
    workerId: text("worker_id").notNull().unique(),
    displayName: text("display_name").notNull(),
    scopeType: text("scope_type").notNull(),
    divisionId: integer("division_id").references(() => divisions.divisionId),
    groupId: integer("group_id").references(() => groups.groupId),
  },
  (t) => [
    check("leaders_scope_type_check", inList(t.scopeType, LEADER_SCOPE_TYPES)),
    check(
      "leaders_scope_matches_type_check",
      sql`(${t.scopeType} = 'division' and ${t.divisionId} is not null and ${t.groupId} is null)
       or (${t.scopeType} = 'group' and ${t.groupId} is not null and ${t.divisionId} is null)`,
    ),
  ],
);

// One approved seat in a squad, filled or not. Seats are never deleted (a vacated seat becomes
// `backfill`). Every update must be `... WHERE seat_id = $1 AND version = $2` and set
// `version = version + 1` (D-011).
// worker_id deliberately has no FK to workday.workers: ingest (BR-03) replaces workday rows from
// each full report, and a worker who disappears from a report or is terminated while still seated
// is a reconciliation exception for dbt to flag, not something that should block ingest or crash
// the board. No position column either (D-029): seats match Workday by worker_id only.
export const seats = app.table(
  "seats",
  {
    seatId: integer("seat_id").primaryKey().generatedAlwaysAsIdentity(),
    squadId: integer("squad_id")
      .notNull()
      .references(() => squads.squadId),
    seatType: text("seat_type").notNull(),
    status: text("status").notNull(),
    workerId: text("worker_id"),
    version: integer("version").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedByLeaderId: integer("updated_by_leader_id").references(() => leaders.leaderId),
  },
  (t) => [
    check("seats_seat_type_check", inList(t.seatType, SEAT_TYPES)),
    check("seats_status_check", inList(t.status, SEAT_STATUSES)),
    check(
      "seats_filled_has_worker_check",
      sql`(${t.status} = 'filled') = (${t.workerId} is not null)`,
    ),
    check("seats_version_check", sql`${t.version} >= 0`),
    // No double-seating: a worker holds at most one seat.
    uniqueIndex("seats_worker_id_key")
      .on(t.workerId)
      .where(sql`${t.workerId} is not null`),
  ],
);

// Append-only audit log (D-010): a trigger (custom migration) raises on UPDATE, DELETE and
// TRUNCATE. A move writes two rows sharing move_id; undo inserts reversing rows.
export const seatChanges = app.table(
  "seat_changes",
  {
    changeId: bigint("change_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    moveId: uuid("move_id"),
    seatId: integer("seat_id")
      .notNull()
      .references(() => seats.seatId),
    changeType: text("change_type").notNull(),
    // The worker the change is about (the mover, the hire, the leaver). No FK: see app.seats.
    workerId: text("worker_id"),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    fromWorkerId: text("from_worker_id"),
    toWorkerId: text("to_worker_id"),
    actorLeaderId: integer("actor_leader_id")
      .notNull()
      .references(() => leaders.leaderId),
    effectiveDate: date("effective_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reversesChangeId: bigint("reverses_change_id", { mode: "number" }),
    note: text("note"),
  },
  (t) => [
    foreignKey({
      name: "seat_changes_reverses_change_id_fkey",
      columns: [t.reversesChangeId],
      foreignColumns: [t.changeId],
    }),
    // A change can be reversed at most once (undoing twice is rejected).
    unique("seat_changes_reverses_change_id_key").on(t.reversesChangeId),
    check("seat_changes_change_type_check", inList(t.changeType, CHANGE_TYPES)),
    check("seat_changes_from_status_check", inList(t.fromStatus, SEAT_STATUSES)),
    check("seat_changes_to_status_check", inList(t.toStatus, SEAT_STATUSES)),
    // Before and after states obey the same rule as app.seats.
    check(
      "seat_changes_from_filled_has_worker_check",
      sql`(${t.fromStatus} = 'filled') = (${t.fromWorkerId} is not null)`,
    ),
    check(
      "seat_changes_to_filled_has_worker_check",
      sql`(${t.toStatus} = 'filled') = (${t.toWorkerId} is not null)`,
    ),
    check(
      "seat_changes_undo_reverses_check",
      sql`(${t.changeType} = 'undo') = (${t.reversesChangeId} is not null)`,
    ),
    check(
      "seat_changes_move_has_move_id_check",
      sql`${t.changeType} not in ('move_out', 'move_in') or ${t.moveId} is not null`,
    ),
  ],
);

// Approved seats per squad per quarter (the leaders' plan).
export const headcountPlan = app.table(
  "headcount_plan",
  {
    squadId: integer("squad_id")
      .notNull()
      .references(() => squads.squadId),
    quarterStart: date("quarter_start").notNull(),
    approvedSeats: integer("approved_seats").notNull(),
  },
  (t) => [
    primaryKey({ name: "headcount_plan_pkey", columns: [t.squadId, t.quarterStart] }),
    check("headcount_plan_approved_seats_check", sql`${t.approvedSeats} >= 0`),
    // quarter_start must be Jan 1, Apr 1, Jul 1 or Oct 1.
    check(
      "headcount_plan_quarter_start_check",
      sql`${t.quarterStart} = date_trunc('quarter', ${t.quarterStart})::date`,
    ),
  ],
);
