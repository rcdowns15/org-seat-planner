import "server-only";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getDb } from "@/server/db";
import { groups, squads, type LEADER_SCOPE_TYPES } from "../../../db/schema/app";
import type { ActionResult } from "@/lib/results";

export type Leader = {
  leaderId: number;
  workerId: string;
  displayName: string;
  scopeType: (typeof LEADER_SCOPE_TYPES)[number]; // CHECK-constrained in the database
  divisionId: number | null;
  groupId: number | null;
};

// Pure scope rule (D-013, D-030): a division leader edits every squad whose group is in their
// division; a group leader edits only squads in their group.
export function scopeAllows(
  leader: Pick<Leader, "scopeType" | "divisionId" | "groupId">,
  squad: { groupId: number; divisionId: number },
): boolean {
  if (leader.scopeType === "division") return leader.divisionId === squad.divisionId;
  if (leader.scopeType === "group") return leader.groupId === squad.groupId;
  return false;
}

// A Drizzle database or transaction handle, so a check can run inside the caller's transaction.
export type DbHandle = Pick<NodePgDatabase, "select">;

// Unknown squad ids are not editable. Pass `db` (e.g. a transaction) to query through it.
export async function canEditSquad(
  leader: Leader | null,
  squadId: number,
  db: DbHandle = getDb(),
): Promise<boolean> {
  if (!leader || !Number.isInteger(squadId)) return false;
  const rows = await db
    .select({ groupId: squads.groupId, divisionId: groups.divisionId })
    .from(squads)
    .innerJoin(groups, eq(groups.groupId, squads.groupId))
    .where(eq(squads.squadId, squadId));
  return rows.length === 1 && scopeAllows(leader, rows[0]);
}

// A mutation that touches several squads (a move touches two) needs permission on every one.
// An empty list is FORBIDDEN: there is nothing to authorize against, so fail closed.
export async function requireEditSquads(
  leader: Leader | null,
  squadIds: number[],
  db: DbHandle = getDb(),
): Promise<ActionResult> {
  if (!leader) {
    return { ok: false, code: "READ_ONLY", message: "Choose a leader to act as before editing." };
  }
  const forbidden = {
    ok: false,
    code: "FORBIDDEN",
    message: "You do not have permission to edit this squad.",
  } as const;
  if (squadIds.length === 0) return forbidden;
  for (const squadId of new Set(squadIds)) {
    if (!(await canEditSquad(leader, squadId, db))) return forbidden;
  }
  return { ok: true };
}
