import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { divisions, groups, headcountPlan, leaders, seats, squads } from "../../db/schema/app";
import { generateSeedData, type SeedData } from "./generate";

// The app-table half of the seed, shared by `pnpm db:seed` (run-seed.ts) and the demo "Reset demo
// data" action (src/server/services/demo-reset.ts), so the two can never drift apart. Nothing here
// touches the filesystem or the workday schema, which keeps it safe to import from the app.

// Postgres allows 65,535 bind parameters per statement: batches of 1,000 rows stay far below that
// even for the widest table here (16 columns).
const BATCH_SIZE = 1000;

function chunk<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) out.push(rows.slice(i, i + BATCH_SIZE));
  return out;
}

// Inserts rows in order and checks the database handed out ids 1..n in that order. The seed
// refers to parents by array position, so this is what keeps the foreign keys right.
async function insertInOrder(
  tx: NodePgDatabase,
  table: PgTable,
  idColumn: AnyPgColumn,
  rows: Record<string, unknown>[],
): Promise<void> {
  let expected = 1;
  for (const batch of chunk(rows)) {
    // Every row value is bound as a parameter by Drizzle. `never` because `table` is generic here.
    const inserted = await tx
      .insert(table)
      .values(batch as never)
      .returning({ id: idColumn });
    for (const { id } of inserted) {
      if (id !== expected++) throw new Error(`Unexpected id ${String(id)} in ${idColumn.name}`);
    }
  }
}

export function toRows(data: SeedData) {
  const { org } = data;
  return {
    divisions: org.divisions.map((d) => ({ name: d.name })),
    groups: org.groups.map((g) => ({ divisionId: g.divisionIndex + 1, name: g.name })),
    squads: org.squads.map((s) => ({ groupId: s.groupIndex + 1, name: s.name })),
    leaders: data.leaders.map((l) => ({
      workerId: l.workerId,
      displayName: l.displayName,
      scopeType: l.scopeType,
      divisionId: l.divisionIndex === null ? null : l.divisionIndex + 1,
      groupId: l.groupIndex === null ? null : l.groupIndex + 1,
    })),
    seats: data.seats.map((s) => ({
      squadId: s.squadIndex + 1,
      seatType: s.seatType,
      status: s.status,
      workerId: s.workerId,
    })),
    plan: data.plan.map((p) => ({
      squadId: p.squadIndex + 1,
      quarterStart: p.quarterStart,
      approvedSeats: p.approvedSeats,
    })),
  };
}

export type AppRows = ReturnType<typeof toRows>;

// The app rows of the fixed seed. Pure: same seed, same rows.
export function generateAppRows(): AppRows {
  return toRows(generateSeedData());
}

// Empties every seeded app table and restarts their ids at 1. Must run in a transaction.
// app.seat_changes is append-only (D-010); its TRUNCATE guard (migration 0002) lets the
// transaction through only after the setting below, which ends with the transaction. This is the
// sanctioned exception, used by the seed and the demo reset, nowhere else.
// app.demo_reset_state is deliberately not here: the reset throttle must survive a reset.
export async function truncateAppTables(tx: NodePgDatabase): Promise<void> {
  await tx.execute(sql`SET LOCAL app.allow_seat_changes_reset = 'on'`);
  // Lock seats before seat_changes: a move updates seats, then inserts into seat_changes, so
  // taking the locks in the same order means a reset and a move cannot deadlock.
  await tx.execute(sql`LOCK TABLE app.seats, app.seat_changes IN ACCESS EXCLUSIVE MODE`);
  await tx.execute(sql`
    TRUNCATE app.seat_changes, app.seats, app.leaders, app.headcount_plan, app.squads,
             app.groups, app.divisions
    RESTART IDENTITY
  `);
}

// Inserts the seed's app rows, parents first. Must run in a transaction, after truncateAppTables.
export async function insertAppRows(tx: NodePgDatabase, rows: AppRows): Promise<void> {
  await insertInOrder(tx, divisions, divisions.divisionId, rows.divisions);
  await insertInOrder(tx, groups, groups.groupId, rows.groups);
  await insertInOrder(tx, squads, squads.squadId, rows.squads);
  await insertInOrder(tx, leaders, leaders.leaderId, rows.leaders);
  await insertInOrder(tx, seats, seats.seatId, rows.seats);
  for (const batch of chunk(rows.plan)) await tx.insert(headcountPlan).values(batch);
}
