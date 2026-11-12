import { createHash } from "node:crypto";
import { asc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  divisions,
  groups,
  headcountPlan,
  leaders,
  seatChanges,
  seats,
  squads,
} from "../../db/schema/app";
import { workers } from "../../db/schema/workday";

// SHA-256 over every seeded row, read back from the database in primary-key order. Columns the
// database fills with the clock (updated_at, created_at) are left out, so the same seed always
// gives the same checksum.
export async function seedChecksum(db: NodePgDatabase): Promise<string> {
  const hash = createHash("sha256");
  const add = (table: string, rows: unknown[]) => {
    hash.update(`${table}\n${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
  };

  add("divisions", await db.select().from(divisions).orderBy(asc(divisions.divisionId)));
  add("groups", await db.select().from(groups).orderBy(asc(groups.groupId)));
  add("squads", await db.select().from(squads).orderBy(asc(squads.squadId)));
  add("leaders", await db.select().from(leaders).orderBy(asc(leaders.leaderId)));
  add(
    "seats",
    (await db.select().from(seats).orderBy(asc(seats.seatId))).map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the clock column
      ({ updatedAt, ...rest }) => rest,
    ),
  );
  add(
    "headcount_plan",
    await db
      .select()
      .from(headcountPlan)
      .orderBy(asc(headcountPlan.squadId), asc(headcountPlan.quarterStart)),
  );
  add(
    "workers",
    (await db.select().from(workers).orderBy(asc(workers.workerId))).map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the clock column
      ({ updatedAt, ...rest }) => rest,
    ),
  );
  add("seat_changes", await db.select({ id: seatChanges.changeId }).from(seatChanges));
  return hash.digest("hex");
}
