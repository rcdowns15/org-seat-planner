import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  MAX_EFFECTIVE_DAYS_AHEAD,
  moveInputSchema,
  type MoveFailureCode,
  type MoveInput,
  type MoveResult,
} from "@/lib/schemas/move";
import type { ActionFailure } from "@/lib/results";
import { getPool } from "@/server/db";
import { requireEditSquads, type Leader } from "@/server/services/permissions";
import { recordSave, StatementRecorder } from "@/server/sql-log";
import { seatChanges, seats } from "../../../db/schema/app";
import { workers } from "../../../db/schema/workday";

// Seat statuses a move can land on. `offer_accepted` seats are reserved for an incoming hire.
const RECEIVING_STATUSES = ["open", "backfill"];

const CONFLICT_MESSAGE = "This seat changed since you loaded it. Refresh and try again.";

// Thrown inside the transaction to roll it back with a typed failure; caught in moveWorker and
// returned as a value, so callers never see it (expected failures are results, not errors).
class MoveAborted extends Error {
  constructor(readonly result: ActionFailure<MoveFailureCode>) {
    super(result.code);
  }
}

function fail(code: MoveFailureCode, message: string): never {
  throw new MoveAborted({ ok: false, code, message });
}

// Calendar dates in UTC as `YYYY-MM-DD`, which compare correctly as strings.
export function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addUtcDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDate(d);
}

export type MoveOptions = {
  // The clock, injectable so tests can pin "today". Defaults to now.
  now?: Date;
};

// Moves a worker from one seat to another (LR-02-03). Checks run in this order, and the first
// one that fails is returned: INVALID_INPUT, READ_ONLY (no leader), FORBIDDEN, CONFLICT (versions
// as read), WORKER_NOT_ACTIVE, NOT_IN_SEAT, SEAT_NOT_AVAILABLE, SEAT_TYPE_MISMATCH,
// INVALID_EFFECTIVE_DATE, EFFECTIVE_DATE_BEFORE_PENDING_CHANGE, CONFLICT (versions at write).
//
// Concurrency (D-011, optimistic locking): the reads take no row locks. The seat read must show
// the versions the leader loaded, so the checks run on exactly the state the lock guards. The
// guard itself is in the writes: each seat UPDATE has `WHERE seat_id = $1 AND version = $2` and
// bumps the version, so if anyone changed either seat after this move read it, the UPDATE
// matches 0 rows, the move returns CONFLICT and the whole transaction rolls back. When two moves
// race for the same seat, both can read it at the loaded version and pass every check; Postgres
// then makes the second UPDATE wait for the first transaction and re-checks its WHERE against
// the committed row, whose version has moved on: exactly one wins.
//
// The source seat is updated before the target so the worker is never in two seats at once
// (the partial unique index on app.seats.worker_id is checked row by row).
export async function moveWorker(
  rawInput: unknown,
  leader: Leader | null,
  options: MoveOptions = {},
): Promise<MoveResult> {
  const parsed = moveInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Invalid move." };
  }
  if (!leader) {
    return { ok: false, code: "READ_ONLY", message: "Choose a leader to act as before editing." };
  }
  const input = parsed.data;
  const today = utcDate(options.now ?? new Date());

  // A Drizzle handle just for this call, whose logger records every statement it sends (with
  // bound values) for the SQL panel. It shares the app's connection pool.
  const recorder = new StatementRecorder();
  const db = drizzle(getPool(), { logger: recorder });

  let result: MoveResult;
  try {
    result = await db.transaction((tx) => runMove(tx, input, leader, today));
  } catch (err) {
    if (!(err instanceof MoveAborted)) throw err; // unexpected (e.g. database down): a real error
    result = err.result;
  }
  recordSave({
    action: "move",
    ok: result.ok,
    code: result.ok ? undefined : result.code,
    statements: recorder.statements,
  });
  return result;
}

// The transaction handle Drizzle passes to the `db.transaction(...)` callback.
type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

async function runMove(
  tx: Tx,
  input: MoveInput,
  leader: Leader,
  today: string,
): Promise<MoveResult> {
  // Both seats in one read (one row if from and to are the same seat).
  const seatRows = await tx
    .select({
      seatId: seats.seatId,
      squadId: seats.squadId,
      seatType: seats.seatType,
      status: seats.status,
      workerId: seats.workerId,
      version: seats.version,
    })
    .from(seats)
    .where(inArray(seats.seatId, [input.fromSeatId, input.toSeatId]));
  const from = seatRows.find((s) => s.seatId === input.fromSeatId);
  const to = seatRows.find((s) => s.seatId === input.toSeatId);

  // FORBIDDEN: permission on both squads (D-013). An unknown seat has no squad to authorize
  // against, so it fails closed the same way.
  if (!from || !to) fail("FORBIDDEN", "That seat does not exist or you cannot edit it.");
  const permission = await requireEditSquads(leader, [from.squadId, to.squadId], tx);
  if (!permission.ok) fail("FORBIDDEN", "You do not have permission to edit both squads.");

  // CONFLICT (early): the seats must be at the versions the leader loaded. Every check below
  // reads these rows, and the UPDATEs only lock on the client's versions, so the two must agree:
  // otherwise a forged version one ahead of the row could pass the checks on the old state and
  // then match the UPDATE after a racing move bumps the version. A stale version therefore
  // returns CONFLICT before WORKER_NOT_ACTIVE and the later checks.
  if (from.version !== input.fromSeatVersion || to.version !== input.toSeatVersion) {
    fail("CONFLICT", CONFLICT_MESSAGE);
  }

  // WORKER_NOT_ACTIVE: Workday is the source of truth for status. A worker missing from Workday
  // isn't known to be active either.
  const [worker] = await tx
    .select({ status: workers.status, workerType: workers.workerType })
    .from(workers)
    .where(eq(workers.workerId, input.workerId));
  if (!worker || worker.status !== "active") {
    fail("WORKER_NOT_ACTIVE", "Only active workers can be moved.");
  }

  // NOT_IN_SEAT: the worker must hold the source seat. This also stops moving someone "from" a
  // seat they don't hold while they sit elsewhere (no double-seating).
  if (from.workerId !== input.workerId) {
    fail("NOT_IN_SEAT", "That worker is not in the seat you are moving them from.");
  }

  // SEAT_NOT_AVAILABLE: only open and backfill seats can receive a move. Moving a worker to the
  // seat they already hold lands here too, because that seat is filled.
  if (input.fromSeatId === input.toSeatId) {
    fail("SEAT_NOT_AVAILABLE", "The worker already holds that seat.");
  }
  if (!RECEIVING_STATUSES.includes(to.status)) {
    fail("SEAT_NOT_AVAILABLE", "The target seat is not open or backfill.");
  }

  // SEAT_TYPE_MISMATCH: employees fill employee seats, contingent workers contingent seats.
  if (worker.workerType !== to.seatType) {
    fail("SEAT_TYPE_MISMATCH", `A ${worker.workerType} worker cannot fill a ${to.seatType} seat.`);
  }

  // INVALID_EFFECTIVE_DATE: today through +90 days, UTC calendar dates, no backdating (D-012).
  const lastAllowed = addUtcDays(today, MAX_EFFECTIVE_DAYS_AHEAD);
  if (input.effectiveDate < today || input.effectiveDate > lastAllowed) {
    fail(
      "INVALID_EFFECTIVE_DATE",
      `The effective date must be between ${today} and ${lastAllowed}.`,
    );
  }

  // EFFECTIVE_DATE_BEFORE_PENDING_CHANGE (D-037): a move can't take effect before a change already
  // recorded for the worker, the source seat or the target seat. Otherwise the history on those
  // dates would not match the order the changes were made in (a worker could be in two seats on
  // one date). An equal date is fine. One bound-parameter read finds the latest date per subject.
  const latest = await latestEffectiveDates(tx, input);
  const earlier = [
    { subject: "worker", date: latest.worker },
    { subject: "source seat", date: latest.fromSeat },
    { subject: "target seat", date: latest.toSeat },
  ].find((s) => s.date !== null && input.effectiveDate < s.date);
  if (earlier) {
    fail(
      "EFFECTIVE_DATE_BEFORE_PENDING_CHANGE",
      `The ${earlier.subject} already has a change effective ${earlier.date}. Choose ${earlier.date} or later.`,
    );
  }

  // CONFLICT: the version-checked writes (D-011). Source first, then target. A move that read
  // the seats before a racing move committed passed the check above and fails here.
  const [fromAfter] = await tx
    .update(seats)
    .set({
      status: "backfill",
      workerId: null,
      version: sql`${seats.version} + 1`,
      updatedAt: sql`now()`,
      updatedByLeaderId: leader.leaderId,
    })
    .where(and(eq(seats.seatId, input.fromSeatId), eq(seats.version, input.fromSeatVersion)))
    .returning({ version: seats.version });
  if (!fromAfter) fail("CONFLICT", CONFLICT_MESSAGE);

  const [toAfter] = await tx
    .update(seats)
    .set({
      status: "filled",
      workerId: input.workerId,
      version: sql`${seats.version} + 1`,
      updatedAt: sql`now()`,
      updatedByLeaderId: leader.leaderId,
    })
    .where(and(eq(seats.seatId, input.toSeatId), eq(seats.version, input.toSeatVersion)))
    .returning({ version: seats.version });
  if (!toAfter) fail("CONFLICT", CONFLICT_MESSAGE);

  // Audit (D-010): two append-only rows sharing one move_id, in the same transaction.
  const moveId = randomUUID();
  await tx.insert(seatChanges).values({
    moveId,
    seatId: input.fromSeatId,
    changeType: "move_out",
    workerId: input.workerId,
    fromStatus: "filled",
    toStatus: "backfill",
    fromWorkerId: input.workerId,
    toWorkerId: null,
    actorLeaderId: leader.leaderId,
    effectiveDate: input.effectiveDate,
  });
  await tx.insert(seatChanges).values({
    moveId,
    seatId: input.toSeatId,
    changeType: "move_in",
    workerId: input.workerId,
    fromStatus: to.status,
    toStatus: "filled",
    fromWorkerId: null,
    toWorkerId: input.workerId,
    actorLeaderId: leader.leaderId,
    effectiveDate: input.effectiveDate,
  });

  return {
    ok: true,
    moveId,
    fromSeat: { seatId: input.fromSeatId, version: fromAfter.version },
    toSeat: { seatId: input.toSeatId, version: toAfter.version },
  };
}

// The latest effective_date (YYYY-MM-DD, or null when none) already recorded in app.seat_changes
// for the worker, the source seat and the target seat. Cast to text so the driver doesn't turn
// the date into a JS Date in the server's time zone. The worker subject matches worker_id,
// from_worker_id and to_worker_id, so writers that set only the from/to columns are still caught.
async function latestEffectiveDates(tx: Tx, input: MoveInput) {
  const workerMatch = or(
    eq(seatChanges.workerId, input.workerId),
    eq(seatChanges.fromWorkerId, input.workerId),
    eq(seatChanges.toWorkerId, input.workerId),
  );
  const latestWhere = (condition: SQL) =>
    sql<string | null>`(max(${seatChanges.effectiveDate}) filter (where ${condition}))::text`;
  const [row] = await tx
    .select({
      worker: latestWhere(sql`${workerMatch}`),
      fromSeat: latestWhere(sql`${seatChanges.seatId} = ${input.fromSeatId}`),
      toSeat: latestWhere(sql`${seatChanges.seatId} = ${input.toSeatId}`),
    })
    .from(seatChanges)
    .where(or(workerMatch, inArray(seatChanges.seatId, [input.fromSeatId, input.toSeatId])));
  return row;
}
