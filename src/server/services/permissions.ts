import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { groups, squads } from "../../../db/schema/app";
import type { ActionResult } from "@/lib/acting-as";

export type Leader = {
  leaderId: number;
  workerId: string;
  displayName: string;
  scopeType: string; // "division" | "group" (CHECK-constrained in the database)
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

// Unknown squad ids are not editable.
export async function canEditSquad(leader: Leader | null, squadId: number): Promise<boolean> {
  if (!leader || !Number.isInteger(squadId)) return false;
  const rows = await getDb()
    .select({ groupId: squads.groupId, divisionId: groups.divisionId })
    .from(squads)
    .innerJoin(groups, eq(groups.groupId, squads.groupId))
    .where(eq(squads.squadId, squadId));
  return rows.length === 1 && scopeAllows(leader, rows[0]);
}

// A mutation that touches several squads (a move touches two) needs permission on every one.
export async function requireEditSquads(
  leader: Leader | null,
  squadIds: number[],
): Promise<ActionResult> {
  if (!leader) {
    return { ok: false, code: "READ_ONLY", message: "Choose a leader to act as before editing." };
  }
  for (const squadId of new Set(squadIds)) {
    if (!(await canEditSquad(leader, squadId))) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "You do not have permission to edit this squad.",
      };
    }
  }
  return { ok: true };
}
