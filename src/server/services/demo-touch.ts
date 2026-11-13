import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { SimulateEditResult } from "@/lib/schemas/demo";
import { utcToday } from "@/lib/dates";
import { getPool } from "@/server/db";
import { requireEditSquads, type Leader } from "@/server/services/permissions";
import { leaders, seatChanges, seats } from "../../../db/schema/app";

// The seeded "Another leader" (scripts/seed/README.md, fixture `another-leader`): a leader other
// than the two demo leaders. They are only ever recorded as the actor of a simulated edit.
export const ANOTHER_LEADER_WORKER_ID = "100003";

type Failure = Extract<SimulateEditResult, { ok: false }>;

// Thrown inside the transaction to roll it back; caught below and returned as a value.
class TouchAborted extends Error {
  constructor(readonly result: Failure) {
    super(result.code);
  }
}

// Simulates a second leader saving something on a seat, so the acting leader's next save on that
// seat hits a stale version (LR-02-05). One transaction (D-010, D-011):
//  1. the acting leader needs permission on the seat's squad (the demo can't touch seats the
//     leader couldn't edit themselves);
//  2. the seat's version is bumped with the optimistic-lock pattern, WHERE seat_id AND version;
//  3. a `demo_touch` row for "Another leader" is appended to app.seat_changes.
// The touch changes nothing about who sits where; it only moves the version and the audit trail.
//
// D-038: the row's effective date is the later of today and the latest effective date already
// recorded for the seat or the worker in it, so it is never earlier than a change already on file
// (a future-dated move on this seat keeps its date). That keeps dbt's as-of seat state correct.
// The caller (the action) has already checked DEMO_MODE.
export async function simulateAnotherLeaderEdit(
  seatId: number,
  leader: Leader,
  options: { now?: Date } = {},
): Promise<SimulateEditResult> {
  const today = utcToday(options.now);
  const db = drizzle(getPool());
  try {
    return await db.transaction(async (tx): Promise<SimulateEditResult> => {
      const [other] = await tx
        .select({ leaderId: leaders.leaderId, displayName: leaders.displayName })
        .from(leaders)
        .where(eq(leaders.workerId, ANOTHER_LEADER_WORKER_ID));
      if (!other) {
        throw new TouchAborted({
          ok: false,
          code: "MISSING_FIXTURE",
          message: "The seeded 'Another leader' is missing. Run pnpm db:seed.",
        });
      }

      const [seat] = await tx
        .select({
          squadId: seats.squadId,
          status: seats.status,
          workerId: seats.workerId,
          version: seats.version,
        })
        .from(seats)
        .where(eq(seats.seatId, seatId));
      const permission = seat ? await requireEditSquads(leader, [seat.squadId], tx) : null;
      if (!seat || !permission?.ok) {
        throw new TouchAborted({
          ok: false,
          code: "FORBIDDEN",
          message: "That seat does not exist or you cannot edit it.",
        });
      }

      // Latest effective date on the seat, or on the worker who holds it (any of the worker
      // columns, like the move service). Text, so the driver does not make a JS Date of it.
      const subject = seat.workerId
        ? or(
            eq(seatChanges.seatId, seatId),
            eq(seatChanges.workerId, seat.workerId),
            eq(seatChanges.fromWorkerId, seat.workerId),
            eq(seatChanges.toWorkerId, seat.workerId),
          )
        : eq(seatChanges.seatId, seatId);
      const [latest] = await tx
        .select({ date: sql<string | null>`max(${seatChanges.effectiveDate})::text` })
        .from(seatChanges)
        .where(subject);
      const effectiveDate = latest?.date && latest.date > today ? latest.date : today;

      const [after] = await tx
        .update(seats)
        .set({
          version: sql`${seats.version} + 1`,
          updatedAt: sql`now()`,
          updatedByLeaderId: other.leaderId,
        })
        .where(and(eq(seats.seatId, seatId), eq(seats.version, seat.version)))
        .returning({ version: seats.version });
      if (!after) {
        throw new TouchAborted({
          ok: false,
          code: "CONFLICT",
          message: "That seat changed while you were simulating. Try again.",
        });
      }

      await tx.insert(seatChanges).values({
        seatId,
        changeType: "demo_touch",
        workerId: seat.workerId,
        fromStatus: seat.status,
        toStatus: seat.status,
        fromWorkerId: seat.workerId,
        toWorkerId: seat.workerId,
        actorLeaderId: other.leaderId,
        effectiveDate,
        // The recorded actor is the seeded "Another leader"; the note says who really ran it.
        note: `Simulated edit by another leader (demo), run by leader ${leader.leaderId}`,
      });

      return {
        ok: true,
        seatId,
        version: after.version,
        effectiveDate,
        actorName: other.displayName,
      };
    });
  } catch (err) {
    if (err instanceof TouchAborted) return err.result;
    throw err;
  }
}
