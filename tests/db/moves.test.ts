import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTING_LEADER_COOKIE } from "@/lib/acting-as";
import type { MoveInput, MoveResult } from "@/lib/schemas/move";
import { runSeed } from "../../scripts/seed/run-seed";

// Stand-in for the request cookie jar, for the server action tests (same as permissions.test.ts).
let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === ACTING_LEADER_COOKIE && cookieValue !== undefined
        ? { name, value: cookieValue }
        : undefined,
  }),
}));

import { getPool } from "@/server/db";
import { findLeader } from "@/server/auth/acting-leader";
import type { Leader } from "@/server/services/permissions";
import { addUtcDays, utcToday } from "@/lib/dates";
import { moveWorker } from "@/server/services/moves";
import { moveWorkerAction } from "@/server/actions/move";
import { clearSqlLog, lastSave } from "@/server/sql-log";

// Named fixtures from scripts/seed/README.md. Every other seat below is found by its attributes
// relative to these (squad, group, status, type), ordered by seat_id, never by a hardcoded position.
const DIVISION_LEADER_WORKER = "100002"; // demo-division-leader
const GROUP_LEADER_WORKER = "100006"; // demo-group-leader: Digital Channels
const OUT_OF_SCOPE_OPEN_SEAT = 206; // out-of-scope-open-seat: in the division, outside the group
const WORKER_ON_LEAVE = "100042"; // worker-on-leave: keeps their seat in Harbor Bridge
const TERMINATED_SEATED_WORKER = "100052"; // terminated-seated-worker: still holds a seat

// These tests commit real moves, so the file starts and ends from a fresh seed: other test files
// see the seeded state, and the fixture lookups below are deterministic.
beforeAll(async () => {
  await runSeed(process.env.DATABASE_URL!);
}, 60_000);
afterAll(async () => {
  await runSeed(process.env.DATABASE_URL!);
  await getPool().end();
}, 60_000);

type SeatRow = { seat_id: number; status: string; worker_id: string | null; version: number };

async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await getPool().query(text, values)).rows as T[];
}

async function seat(seatId: number): Promise<SeatRow> {
  const [row] = await query<SeatRow>(
    "select seat_id, status, worker_id, version from app.seats where seat_id = $1",
    [seatId],
  );
  return row;
}

async function seatOf(workerId: string): Promise<SeatRow> {
  const [row] = await query<SeatRow>(
    "select seat_id, status, worker_id, version from app.seats where worker_id = $1",
    [workerId],
  );
  return row;
}

async function changeCount(): Promise<number> {
  const [row] = await query<{ n: number }>("select count(*)::int n from app.seat_changes");
  return row.n;
}

async function leaderByWorker(workerId: string): Promise<Leader> {
  const [row] = await query<{ leader_id: number }>(
    "select leader_id from app.leaders where worker_id = $1",
    [workerId],
  );
  const leader = await findLeader(row.leader_id);
  if (!leader) throw new Error(`no leader for worker ${workerId}`);
  return leader;
}

// Asserts a move attempt changed nothing: both seats' status, worker and version, and the number
// of audit rows, are exactly as before.
async function expectNothingWritten(
  attempt: () => Promise<MoveResult>,
  seatIds: number[],
): Promise<MoveResult> {
  const before = await Promise.all(seatIds.map(seat));
  const changesBefore = await changeCount();
  const result = await attempt();
  expect(await Promise.all(seatIds.map(seat))).toEqual(before);
  expect(await changeCount()).toBe(changesBefore);
  return result;
}

const today = () => utcToday();

let divisionLeader: Leader;
let groupLeader: Leader;
let movers: SeatRow[]; // active employees seated in the worker-on-leave's squad (Harbor Bridge)
let openTargets: SeatRow[]; // open employee seats in other Digital Channels squads
let backfillTarget: SeatRow; // a backfill employee seat in another Digital Channels squad
let offerSeat: SeatRow; // an offer_accepted employee seat in Digital Channels
let contingentOpenSeat: SeatRow; // an open contingent seat in Digital Channels
let someoneElsesSeat: SeatRow; // a filled seat in another Digital Channels squad
let outsideMovers: SeatRow[]; // active employees seated in the division but outside the group
let contingentMover: SeatRow; // an active contingent worker seated in Digital Channels

beforeAll(async () => {
  divisionLeader = await leaderByWorker(DIVISION_LEADER_WORKER);
  groupLeader = await leaderByWorker(GROUP_LEADER_WORKER);
  const [{ squad_id: homeSquadId }] = await query<{ squad_id: number }>(
    "select squad_id from app.seats where worker_id = $1",
    [WORKER_ON_LEAVE],
  );

  movers = await query<SeatRow>(
    `select s.seat_id, s.status, s.worker_id, s.version
     from app.seats s join workday.workers w on w.worker_id = s.worker_id
     where s.squad_id = $1 and s.seat_type = 'employee'
       and w.status = 'active' and w.worker_type = 'employee'
     order by s.seat_id`,
    [homeSquadId],
  );
  // Seats in the demo group with a given status and type; `otherSquad` excludes the movers' squad.
  const groupSeats = (status: string, type: string, otherSquad: boolean) =>
    query<SeatRow>(
      `select s.seat_id, s.status, s.worker_id, s.version
       from app.seats s join app.squads q on q.squad_id = s.squad_id
       where q.group_id = $1 and s.status = $2 and s.seat_type = $3
         and (not $4 or s.squad_id <> $5)
       order by s.seat_id`,
      [groupLeader.groupId, status, type, otherSquad, homeSquadId],
    );
  openTargets = await groupSeats("open", "employee", true);
  [backfillTarget] = await groupSeats("backfill", "employee", true);
  [offerSeat] = await groupSeats("offer_accepted", "employee", false);
  [contingentOpenSeat] = await groupSeats("open", "contingent", false);
  [someoneElsesSeat] = await groupSeats("filled", "employee", true);
  outsideMovers = await query<SeatRow>(
    `select s.seat_id, s.status, s.worker_id, s.version
     from app.seats s
     join app.squads q on q.squad_id = s.squad_id
     join app.groups g on g.group_id = q.group_id
     join workday.workers w on w.worker_id = s.worker_id
     where g.division_id = $1 and q.group_id <> $2 and s.seat_type = 'employee'
       and w.status = 'active' and w.worker_type = 'employee'
     order by s.seat_id
     limit 3`,
    [divisionLeader.divisionId, groupLeader.groupId],
  );
  [contingentMover] = await query<SeatRow>(
    `select s.seat_id, s.status, s.worker_id, s.version
     from app.seats s
     join app.squads q on q.squad_id = s.squad_id
     join workday.workers w on w.worker_id = s.worker_id
     where q.group_id = $1 and s.seat_type = 'contingent'
       and w.status = 'active' and w.worker_type = 'contingent'
     order by s.seat_id`,
    [groupLeader.groupId],
  );

  expect(movers.length).toBeGreaterThanOrEqual(7);
  expect(openTargets.length).toBeGreaterThanOrEqual(5);
  expect(outsideMovers).toHaveLength(3);
  for (const s of [
    backfillTarget,
    offerSeat,
    contingentOpenSeat,
    someoneElsesSeat,
    contingentMover,
  ]) {
    expect(s).toBeDefined();
  }
}, 30_000);

// A valid move of `mover` to `target`, at the versions those rows were read with.
function moveOf(mover: SeatRow, target: SeatRow, overrides: Partial<MoveInput> = {}): MoveInput {
  return {
    workerId: mover.worker_id!,
    fromSeatId: mover.seat_id,
    toSeatId: target.seat_id,
    effectiveDate: addUtcDays(today(), 7),
    fromSeatVersion: mover.version,
    toSeatVersion: target.version,
    ...overrides,
  };
}

describe("moveWorker failure codes: each returns its code and writes nothing", () => {
  it("INVALID_INPUT: input that fails the Zod schema", async () => {
    const input = { ...moveOf(movers[0], openTargets[0]), effectiveDate: "11/20/2026" };
    const result = await expectNothingWritten(
      () => moveWorker(input, groupLeader),
      [movers[0].seat_id, openTargets[0].seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("READ_ONLY: no acting leader", async () => {
    const result = await expectNothingWritten(
      () => moveWorker(moveOf(movers[0], openTargets[0]), null),
      [movers[0].seat_id, openTargets[0].seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "READ_ONLY" });
  });

  it("FORBIDDEN: the group leader can't move into a squad outside their group", async () => {
    const target = await seat(OUT_OF_SCOPE_OPEN_SEAT);
    expect(target.status).toBe("open"); // a valid target otherwise
    const result = await expectNothingWritten(
      () => moveWorker(moveOf(movers[0], target), groupLeader),
      [movers[0].seat_id, target.seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("FORBIDDEN: the group leader can't move someone out of a squad outside their group", async () => {
    // The target is an open employee seat inside Digital Channels, so only the source squad
    // (in the division, outside the group) is out of scope.
    const mover = outsideMovers[0];
    const result = await expectNothingWritten(
      () => moveWorker(moveOf(mover, openTargets[0]), groupLeader),
      [mover.seat_id, openTargets[0].seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("FORBIDDEN: an unknown seat fails closed", async () => {
    const input = { ...moveOf(movers[0], openTargets[0]), toSeatId: 2_000_000_000 };
    const result = await expectNothingWritten(
      () => moveWorker(input, divisionLeader),
      [movers[0].seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("WORKER_NOT_ACTIVE: a worker on leave keeps their seat and can't be moved", async () => {
    const onLeave = await seatOf(WORKER_ON_LEAVE);
    const result = await expectNothingWritten(
      () => moveWorker(moveOf(onLeave, openTargets[0]), groupLeader),
      [onLeave.seat_id, openTargets[0].seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "WORKER_NOT_ACTIVE" });
  });

  it("WORKER_NOT_ACTIVE: a terminated worker who still holds a seat can't be moved", async () => {
    const terminated = await seatOf(TERMINATED_SEATED_WORKER);
    const result = await expectNothingWritten(
      () => moveWorker(moveOf(terminated, openTargets[0]), divisionLeader),
      [terminated.seat_id, openTargets[0].seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "WORKER_NOT_ACTIVE" });
  });

  it("NOT_IN_SEAT: the worker doesn't hold the source seat (they sit elsewhere)", async () => {
    // movers[0] really sits in their own seat; claiming someone else's seat as the source
    // would otherwise seat them twice.
    const input = moveOf(movers[0], openTargets[0], {
      fromSeatId: someoneElsesSeat.seat_id,
      fromSeatVersion: someoneElsesSeat.version,
    });
    const result = await expectNothingWritten(
      () => moveWorker(input, groupLeader),
      [someoneElsesSeat.seat_id, openTargets[0].seat_id, movers[0].seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "NOT_IN_SEAT" });
  });

  it("SEAT_NOT_AVAILABLE: an offer_accepted seat is reserved", async () => {
    const result = await expectNothingWritten(
      () => moveWorker(moveOf(movers[0], offerSeat), groupLeader),
      [movers[0].seat_id, offerSeat.seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "SEAT_NOT_AVAILABLE" });
  });

  it("SEAT_NOT_AVAILABLE: a seat someone else fills", async () => {
    const result = await expectNothingWritten(
      () => moveWorker(moveOf(movers[0], someoneElsesSeat), groupLeader),
      [movers[0].seat_id, someoneElsesSeat.seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "SEAT_NOT_AVAILABLE" });
  });

  it("SEAT_NOT_AVAILABLE: moving a worker to the seat they already hold is rejected", async () => {
    const result = await expectNothingWritten(
      () => moveWorker(moveOf(movers[0], movers[0]), groupLeader),
      [movers[0].seat_id],
    );
    expect(result).toMatchObject({
      ok: false,
      code: "SEAT_NOT_AVAILABLE",
      message: "The worker already holds that seat.",
    });
  });

  it("SEAT_TYPE_MISMATCH: an employee can't fill a contingent seat", async () => {
    const result = await expectNothingWritten(
      () => moveWorker(moveOf(movers[0], contingentOpenSeat), groupLeader),
      [movers[0].seat_id, contingentOpenSeat.seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "SEAT_TYPE_MISMATCH" });
  });

  it("SEAT_TYPE_MISMATCH: a contingent worker can't fill an employee seat", async () => {
    const result = await expectNothingWritten(
      () => moveWorker(moveOf(contingentMover, openTargets[0]), groupLeader),
      [contingentMover.seat_id, openTargets[0].seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "SEAT_TYPE_MISMATCH" });
  });

  it.each([
    ["yesterday (backdated)", -1],
    ["today + 91 days", 91],
    ["a year ago", -365],
  ])("INVALID_EFFECTIVE_DATE: %s", async (_label, days) => {
    const input = moveOf(movers[0], openTargets[0], { effectiveDate: addUtcDays(today(), days) });
    const result = await expectNothingWritten(
      () => moveWorker(input, groupLeader),
      [movers[0].seat_id, openTargets[0].seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "INVALID_EFFECTIVE_DATE" });
  });

  it("'today' is the UTC calendar date of the injected clock", async () => {
    // 23:30 on Dec 31 in New York is already Jan 1 in UTC, so Dec 31 is backdated.
    const now = new Date("2027-01-01T04:30:00Z");
    const input = moveOf(movers[0], openTargets[0], { effectiveDate: "2026-12-31" });
    const result = await moveWorker(input, groupLeader, { now });
    expect(result).toMatchObject({ ok: false, code: "INVALID_EFFECTIVE_DATE" });
    expect(result.ok === false && result.message).toContain("2027-01-01 and 2027-04-01");
  });

  it("CONFLICT: the source seat's version is stale", async () => {
    const input = moveOf(movers[0], openTargets[0], { fromSeatVersion: movers[0].version + 1 });
    const result = await expectNothingWritten(
      () => moveWorker(input, groupLeader),
      [movers[0].seat_id, openTargets[0].seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("CONFLICT: a target version one ahead of the row is caught at the read, before any UPDATE", async () => {
    // A forged version one ahead would match the UPDATE right after a racing move bumped the
    // row, so the read must reject it: every check then runs on the state the lock guards.
    // (A matched source UPDATE being rolled back is proved by the concurrency test's loser.)
    clearSqlLog();
    const input = moveOf(movers[0], openTargets[0], { toSeatVersion: openTargets[0].version + 1 });
    const result = await expectNothingWritten(
      () => moveWorker(input, groupLeader),
      [movers[0].seat_id, openTargets[0].seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "CONFLICT" });
    const sqls = lastSave()!.statements.map((s) => s.sql);
    expect(sqls.filter((s) => /^update "app"\."seats"/.test(s))).toHaveLength(0);
    expect(sqls.at(-1)).toBe("rollback");
    expect(lastSave()).toMatchObject({ action: "move", ok: false, code: "CONFLICT" });
  });

  it("CONFLICT: a stale version is reported before the later checks", async () => {
    // At the right version, this offer_accepted target would be SEAT_NOT_AVAILABLE.
    const input = moveOf(movers[0], offerSeat, { toSeatVersion: offerSeat.version + 1 });
    const result = await expectNothingWritten(
      () => moveWorker(input, groupLeader),
      [movers[0].seat_id, offerSeat.seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "CONFLICT" });
  });
});

describe("moveWorker success", () => {
  it("moves the worker: source backfill, target filled, versions +1, two audit rows", async () => {
    const mover = movers[0];
    const target = backfillTarget;
    const effectiveDate = addUtcDays(today(), 14);
    const changesBefore = await changeCount();

    const result = await moveWorker(moveOf(mover, target, { effectiveDate }), groupLeader);

    expect(result).toMatchObject({
      ok: true,
      fromSeat: { seatId: mover.seat_id, version: mover.version + 1 },
      toSeat: { seatId: target.seat_id, version: target.version + 1 },
    });
    if (!result.ok) throw new Error("unreachable");
    expect(await seat(mover.seat_id)).toEqual({
      seat_id: mover.seat_id,
      status: "backfill",
      worker_id: null,
      version: mover.version + 1,
    });
    expect(await seat(target.seat_id)).toEqual({
      seat_id: target.seat_id,
      status: "filled",
      worker_id: mover.worker_id,
      version: target.version + 1,
    });
    const [updatedBy] = await query<{ ids: number[] }>(
      "select array_agg(distinct updated_by_leader_id) ids from app.seats where seat_id in ($1, $2)",
      [mover.seat_id, target.seat_id],
    );
    expect(updatedBy.ids).toEqual([groupLeader.leaderId]);

    expect(await changeCount()).toBe(changesBefore + 2);
    const audit = await query<Record<string, unknown>>(
      `select move_id, seat_id, change_type, worker_id, from_status, to_status, from_worker_id,
              to_worker_id, actor_leader_id, to_char(effective_date, 'YYYY-MM-DD') effective_date
       from app.seat_changes where move_id = $1 order by change_id`,
      [result.moveId],
    );
    expect(audit).toEqual([
      {
        move_id: result.moveId,
        seat_id: mover.seat_id,
        change_type: "move_out",
        worker_id: mover.worker_id,
        from_status: "filled",
        to_status: "backfill",
        from_worker_id: mover.worker_id,
        to_worker_id: null,
        actor_leader_id: groupLeader.leaderId,
        effective_date: effectiveDate,
      },
      {
        move_id: result.moveId,
        seat_id: target.seat_id,
        change_type: "move_in",
        worker_id: mover.worker_id,
        from_status: "backfill",
        to_status: "filled",
        from_worker_id: null,
        to_worker_id: mover.worker_id,
        actor_leader_id: groupLeader.leaderId,
        effective_date: effectiveDate,
      },
    ]);
  });

  it("allows a seat-to-seat move within one squad (still audited)", async () => {
    const mover = movers[1];
    const [sameSquadOpen] = await query<SeatRow>(
      `select seat_id, status, worker_id, version from app.seats
       where status = 'open' and seat_type = 'employee'
         and squad_id = (select squad_id from app.seats where seat_id = $1)
       order by seat_id`,
      [mover.seat_id],
    );
    const result = await moveWorker(moveOf(mover, sameSquadOpen), groupLeader);
    expect(result).toMatchObject({ ok: true });
    expect((await seat(sameSquadOpen.seat_id)).worker_id).toBe(mover.worker_id);
    const [n] = await query<{ n: number }>(
      "select count(*)::int n from app.seat_changes where move_id = $1",
      [result.ok ? result.moveId : null],
    );
    expect(n.n).toBe(2);
  });
});

describe("moveWorker effective-date window boundaries", () => {
  // Proved by succeeding: at the loaded versions, nothing after the date check can fail.
  it.each([
    ["today", 0, 1, 3],
    ["today + 90 days", 90, 2, 4],
  ])("accepts %s", async (_label, days, moverIndex, targetIndex) => {
    const mover = outsideMovers[moverIndex];
    const target = openTargets[targetIndex];
    const effectiveDate = addUtcDays(today(), days);
    const result = await moveWorker(moveOf(mover, target, { effectiveDate }), divisionLeader);
    expect(result).toMatchObject({ ok: true });
    const [row] = await query<{ effective_date: string }>(
      `select distinct to_char(effective_date, 'YYYY-MM-DD') effective_date
       from app.seat_changes where move_id = $1`,
      [result.ok ? result.moveId : null],
    );
    expect(row.effective_date).toBe(effectiveDate);
  });
});

describe("SQL log (ring buffer for the SQL panel)", () => {
  it("captures the version-checked UPDATEs and the two audit INSERTs, with bound values", async () => {
    clearSqlLog();
    const mover = movers[2];
    const target = openTargets[0];
    const input = moveOf(mover, target);
    const result = await moveWorker(input, groupLeader);
    expect(result).toMatchObject({ ok: true });

    const save = lastSave()!;
    expect(save).toMatchObject({ action: "move", ok: true });
    const statements = save.statements;
    expect(statements[0].sql).toBe("begin");
    expect(statements.at(-1)!.sql).toBe("commit");

    const updates = statements.filter((s) => /^update "app"\."seats"/.test(s.sql));
    expect(updates).toHaveLength(2);
    for (const [u, seatId, version] of [
      [updates[0], input.fromSeatId, input.fromSeatVersion],
      [updates[1], input.toSeatId, input.toSeatVersion],
    ] as const) {
      // WHERE seat_id = $n AND version = $m, and the values are bound, not inlined.
      const m =
        /where \("app"\."seats"\."seat_id" = \$(\d+) and "app"\."seats"\."version" = \$(\d+)\)/.exec(
          u.sql,
        );
      expect(m, u.sql).not.toBeNull();
      expect(u.params[Number(m![1]) - 1]).toBe(seatId);
      expect(u.params[Number(m![2]) - 1]).toBe(version);
      expect(u.sql).toContain('"version" = "app"."seats"."version" + 1');
    }

    const inserts = statements.filter((s) => /^insert into "app"\."seat_changes"/.test(s.sql));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params).toContain("move_out");
    expect(inserts[1].params).toContain("move_in");

    // No input value appears inside any SQL text: every one is a bound parameter.
    for (const s of statements) {
      expect(s.sql).not.toContain(input.workerId);
      expect(s.sql).not.toContain(input.effectiveDate);
    }
    expect(statements.flatMap((s) => s.params)).toContain(input.workerId);
  });
});

describe("concurrency", () => {
  // Waits until `n` backends in this database are blocked on a lock.
  async function waitForLockWaiters(n: number): Promise<void> {
    const deadline = Date.now() + 4000;
    for (;;) {
      const [row] = await query<{ n: number }>(
        `select count(*)::int n from pg_stat_activity
         where datname = current_database() and wait_event_type = 'Lock'
           and query ilike 'update "app"."seats"%'`,
      );
      if (row.n >= n) return;
      if (Date.now() > deadline) throw new Error(`only ${row.n} of ${n} lock waiters`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  it("two moves racing for the same target seat: exactly one succeeds, one gets CONFLICT", async () => {
    const [a, b] = [movers[3], movers[4]];
    const target = openTargets[1];
    const changesBefore = await changeCount();

    // A third connection holds the target row so both moves are guaranteed to have read the seat
    // as open at the version they were given (and passed every check, including the read-time
    // version check) before either writes: the real race. The loser read the old version before
    // the winner committed, so only its version-checked UPDATE can stop it. Each moveWorker
    // runs on its own pooled connection and transaction and blocks in its target UPDATE.
    const blocker = await getPool().connect();
    let results: MoveResult[];
    try {
      await blocker.query("begin");
      await blocker.query("select 1 from app.seats where seat_id = $1 for update", [
        target.seat_id,
      ]);
      const racing = [
        moveWorker(moveOf(a, target), groupLeader),
        moveWorker(moveOf(b, target), groupLeader),
      ];
      await waitForLockWaiters(2);
      await blocker.query("rollback"); // release: one UPDATE goes through, the other waits for it
      results = await Promise.all(racing);
    } finally {
      blocker.release();
    }

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([expect.objectContaining({ ok: false, code: "CONFLICT" })]);

    const winner = results[0].ok ? a : b;
    const loser = results[0].ok ? b : a;
    expect(await seat(target.seat_id)).toEqual({
      seat_id: target.seat_id,
      status: "filled",
      worker_id: winner.worker_id,
      version: target.version + 1,
    });
    expect(await seat(winner.seat_id)).toMatchObject({ status: "backfill", worker_id: null });
    // The loser's source update was rolled back with the rest of its transaction.
    expect(await seat(loser.seat_id)).toEqual(loser);
    expect(await changeCount()).toBe(changesBefore + 2);
  });

  it("an unsynchronized race never double-fills a seat", async () => {
    const [a, b] = [movers[5], movers[6]];
    const target = openTargets[2];
    const results = await Promise.all([
      moveWorker(moveOf(a, target), groupLeader),
      moveWorker(moveOf(b, target), groupLeader),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    // The loser either read the seat after the winner committed (SEAT_NOT_AVAILABLE) or before
    // (CONFLICT at the version-checked UPDATE).
    const loser = results.find((r) => !r.ok);
    expect(["CONFLICT", "SEAT_NOT_AVAILABLE"]).toContain(loser?.ok === false && loser.code);
    expect((await seat(target.seat_id)).version).toBe(target.version + 1);
  });
});

describe("moveWorkerAction: the acting leader comes from the cookie, never the input", () => {
  it("ignores a spoofed leader id: the group leader's cookie is FORBIDDEN outside their group", async () => {
    const mover = await freshMover();
    const target = await seat(OUT_OF_SCOPE_OPEN_SEAT);
    cookieValue = String(groupLeader.leaderId);
    const result = await expectNothingWritten(
      () =>
        moveWorkerAction({
          ...moveOf(mover, target),
          leaderId: divisionLeader.leaderId, // would be allowed, if input were trusted
          actorLeaderId: divisionLeader.leaderId,
        }),
      [mover.seat_id, target.seat_id],
    );
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("records the cookie's leader as the actor even when the input names another", async () => {
    const mover = await freshMover();
    const target = await seat(OUT_OF_SCOPE_OPEN_SEAT);
    cookieValue = String(divisionLeader.leaderId);
    const result = await moveWorkerAction({
      ...moveOf(mover, target),
      leaderId: groupLeader.leaderId,
    });
    expect(result).toMatchObject({ ok: true });
    const actors = await query<{ actor_leader_id: number }>(
      "select actor_leader_id from app.seat_changes where move_id = $1",
      [result.ok ? result.moveId : null],
    );
    expect(actors.map((r) => r.actor_leader_id)).toEqual([
      divisionLeader.leaderId,
      divisionLeader.leaderId,
    ]);
  });

  it("returns READ_ONLY without a valid cookie, and INVALID_INPUT for bad input", async () => {
    const mover = await freshMover();
    cookieValue = undefined;
    expect(await moveWorkerAction(moveOf(mover, openTargets[0]))).toMatchObject({
      ok: false,
      code: "READ_ONLY",
    });
    cookieValue = String(divisionLeader.leaderId);
    expect(await moveWorkerAction({ workerId: mover.worker_id })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
  });
});

// The first mover still seated where the seed put them (earlier tests moved some).
async function freshMover(): Promise<SeatRow> {
  for (const m of movers) {
    const now = await seat(m.seat_id);
    if (now.worker_id === m.worker_id) return now;
  }
  throw new Error("no unmoved mover left");
}
