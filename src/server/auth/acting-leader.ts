import "server-only";
import { cookies } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { ACTING_LEADER_COOKIE } from "@/lib/acting-as";
import { divisions, groups, leaders } from "../../../db/schema/app";
import type { Leader } from "@/server/services/permissions";

// Only plain positive integers are valid ids ("12abc", "1e3", " 7" and "-1" are not).
export function parseLeaderId(value: string | undefined | null): number | null {
  if (!value || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return id <= 2_147_483_647 ? id : null; // Postgres integer max
}

export async function findLeader(leaderId: number): Promise<Leader | null> {
  const rows = await getDb()
    .select({
      leaderId: leaders.leaderId,
      workerId: leaders.workerId,
      displayName: leaders.displayName,
      scopeType: leaders.scopeType,
      divisionId: leaders.divisionId,
      groupId: leaders.groupId,
    })
    .from(leaders)
    .where(eq(leaders.leaderId, leaderId));
  return rows.length === 1 ? rows[0] : null;
}

// Validates a raw cookie value against app.leaders. Anything unknown or malformed is null, which
// means read-only mode (never an error).
export async function resolveLeaderFromCookieValue(
  value: string | undefined | null,
): Promise<Leader | null> {
  const id = parseLeaderId(value);
  return id === null ? null : findLeader(id);
}

// The acting leader for this request, from the server-side cookie. Null means read-only.
export async function getActingLeader(): Promise<Leader | null> {
  const store = await cookies();
  return resolveLeaderFromCookieValue(store.get(ACTING_LEADER_COOKIE)?.value);
}

export type LeaderOption = { leaderId: number; label: string };

// Seeded leaders for the header dropdown, with their scope in the label.
export async function listLeaderOptions(): Promise<LeaderOption[]> {
  const rows = await getDb()
    .select({
      leaderId: leaders.leaderId,
      displayName: leaders.displayName,
      scopeType: leaders.scopeType,
      divisionName: divisions.name,
      groupName: groups.name,
    })
    .from(leaders)
    .leftJoin(divisions, eq(divisions.divisionId, leaders.divisionId))
    .leftJoin(groups, eq(groups.groupId, leaders.groupId))
    .orderBy(asc(leaders.leaderId));
  return rows.map((r) => ({
    leaderId: r.leaderId,
    label: `${r.displayName} (${r.scopeType}: ${r.scopeType === "division" ? r.divisionName : r.groupName})`,
  }));
}
