import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUtcDays, utcToday } from "@/lib/dates";
import { findLeader } from "@/server/auth/acting-leader";
import { getPool } from "@/server/db";
import {
  ROW_LIMIT,
  getUnderTheHood,
  inReadOnlyTransaction,
  runReadOnlyQuery,
  type PanelSection,
} from "@/server/queries/under-the-hood";
import { moveWorker } from "@/server/services/moves";
import type { Leader } from "@/server/services/permissions";
import { clearSqlLog } from "@/server/sql-log";
import { runSeed } from "../../scripts/seed/run-seed";

// Named fixture (scripts/seed/README.md): demo-group-leader, leads Digital Channels.
const GROUP_LEADER_WORKER = "100006";
const WORKER_ON_LEAVE = "100042"; // worker-on-leave: seated in squad Harbor Bridge (Digital Channels)

// The move test commits a real move, so the file starts and ends from a fresh seed.
beforeAll(async () => {
  await runSeed(process.env.DATABASE_URL!);
  clearSqlLog();
}, 60_000);
afterAll(async () => {
  await runSeed(process.env.DATABASE_URL!);
  await getPool().end();
}, 60_000);

async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await getPool().query(text, values)).rows as T[];
}

function section(sections: PanelSection[], key: string): PanelSection {
  const s = sections.find((x) => x.key === key);
  if (!s) throw new Error(`no section ${key}`);
  return s;
}

// Rows of a section as column -> value objects.
function rowsOf(s: PanelSection): Record<string, string>[] {
  if (!s.result || !s.result.ok) throw new Error(`section ${s.key} has no result`);
  const { columns, rows } = s.result;
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
}

describe("runReadOnlyQuery", () => {
  it("rejects a write: READ ONLY transaction, nothing written", async () => {
    const before = await query<{ n: number }>("select count(*)::int n from app.divisions");
    const insert = await runReadOnlyQuery("insert into app.divisions (name) values ($1)", [
      "Should Not Exist",
    ]);
    expect(insert).toMatchObject({ ok: false, code: "READ_ONLY_VIOLATION" });

    const seatsBefore = await query("select seat_id, version from app.seats order by seat_id");
    const update = await runReadOnlyQuery("update app.seats set version = version + 1", []);
    expect(update).toMatchObject({ ok: false, code: "READ_ONLY_VIOLATION" });

    expect(await query("select count(*)::int n from app.divisions")).toEqual(before);
    expect(await query("select seat_id, version from app.seats order by seat_id")).toEqual(
      seatsBefore,
    );
  });

  it("stops a slow query at the 2 second timeout", async () => {
    const started = Date.now();
    const result = await runReadOnlyQuery("select pg_sleep(10)", []);
    const elapsed = Date.now() - started;
    expect(result).toMatchObject({ ok: false, code: "TIMEOUT" });
    expect(elapsed).toBeGreaterThanOrEqual(1500);
    expect(elapsed).toBeLessThan(5000);
  }, 15_000);

  it("keeps at most 200 rows and says so", async () => {
    const result = await runReadOnlyQuery("select g from generate_series(1, $1::int) g", [300]);
    expect(result).toMatchObject({ ok: true, truncated: true });
    if (!result.ok) throw new Error("unreachable");
    expect(result.rows).toHaveLength(ROW_LIMIT);
  });

  it("reports truncation only past the cap: 201 rows truncate, 200 do not", async () => {
    const over = await runReadOnlyQuery("select g from generate_series(1, $1::int) g", [201]);
    expect(over).toMatchObject({ ok: true, truncated: true });
    if (!over.ok) throw new Error("unreachable");
    expect(over.rows).toHaveLength(ROW_LIMIT);
    const exact = await runReadOnlyQuery("select g from generate_series(1, $1::int) g", [200]);
    expect(exact).toMatchObject({ ok: true, truncated: false });
  });

  it("leaves the connection usable after a failure (pool is not poisoned)", async () => {
    await runReadOnlyQuery("select * from no_such_table", []);
    expect(await runReadOnlyQuery("select 1 as one", [])).toMatchObject({
      ok: true,
      rows: [["1"]],
    });
  });
});

describe("savepoint recovery", () => {
  it("one transaction keeps working after a timeout, an error and a refused write", async () => {
    const out = await inReadOnlyTransaction(async (run) => [
      await run("select pg_sleep(10)", []),
      await run("select * from no_such_table", []),
      await run("insert into app.divisions (name) values ($1)", ["Should Not Exist"]),
      await run("show transaction_read_only", []),
      await run("show statement_timeout", []),
      await run("select 1 as one", []),
    ]);
    if (!out.ok) throw new Error("could not connect");
    const [timeout, error, write, readOnly, stmtTimeout, one] = out.value;
    expect(timeout).toMatchObject({ ok: false, code: "TIMEOUT" });
    expect(error).toMatchObject({ ok: false, code: "QUERY_ERROR" });
    expect(write).toMatchObject({ ok: false, code: "READ_ONLY_VIOLATION" });
    expect(readOnly).toMatchObject({ ok: true, rows: [["on"]] });
    expect(stmtTimeout).toMatchObject({ ok: true, rows: [["2s"]] });
    expect(one).toMatchObject({ ok: true, rows: [["1"]] });
  }, 15_000);
});

describe("getUnderTheHood", () => {
  it("rejects ids that are not positive integers", async () => {
    await expect(getUnderTheHood({ seatId: -1, groupId: null })).rejects.toThrow();
    await expect(getUnderTheHood({ seatId: 1.5, groupId: null })).rejects.toThrow();
    await expect(
      getUnderTheHood({ seatId: "1; drop table app.seats", groupId: null }),
    ).rejects.toThrow();
  });

  it("with no selection and no move: seat and worker presets and impact show empty states", async () => {
    const { sections, lastSave } = await getUnderTheHood({ seatId: null, groupId: null });
    expect(lastSave).toBeNull();
    expect(section(sections, "seat").empty).toMatch(/Select a seat/);
    expect(section(sections, "worker").empty).toMatch(/Select a filled seat/);
    expect(section(sections, "plan_gaps").empty).not.toBeNull();
    expect(section(sections, "last_move_impact").empty).toMatch(/No move yet/);
    expect(rowsOf(section(sections, "recent_changes"))).toHaveLength(0);
  });

  it("analytics presets run read-only and never surface a database error, built or not", async () => {
    const { sections } = await getUnderTheHood({ seatId: null, groupId: null });
    for (const key of ["reconciliation_exceptions", "workday_changes", "squad_headcount_vs_plan"]) {
      const s = section(sections, key);
      // Either the mart's rows (or its empty message), or the "not built yet" message: whichever
      // state the analytics schema is in, the section is not an error.
      expect(s.result === null || s.result.ok, `${key} must not be an error`).toBe(true);
      expect(s.sql).toMatch(/^select /);
      expect(s.sql).not.toMatch(/\b(insert|update|delete|drop)\b/i);
    }
  });

  it("selected seat and worker presets bind the seat id and show version and Workday record", async () => {
    const [seat] = await query<{ seat_id: number; version: number; squad_id: number }>(
      "select seat_id, version, squad_id from app.seats where worker_id = $1",
      [WORKER_ON_LEAVE],
    );
    const { sections } = await getUnderTheHood({ seatId: seat.seat_id, groupId: null });
    const seatSection = section(sections, "seat");
    expect(seatSection.params).toEqual([seat.seat_id]);
    expect(seatSection.sql).toContain("$1");
    expect(rowsOf(seatSection)[0]).toMatchObject({
      seat_id: String(seat.seat_id),
      version: String(seat.version),
      worker_id: WORKER_ON_LEAVE,
    });
    expect(rowsOf(section(sections, "worker"))[0]).toMatchObject({
      worker_id: WORKER_ON_LEAVE,
      status: "leave",
    });
  });
});

describe("plan_gaps preset", () => {
  it("open, backfill, plan and variance match an independent count per squad", async () => {
    const [group] = await query<{ group_id: number }>(
      "select group_id from app.leaders where worker_id = $1",
      [GROUP_LEADER_WORKER],
    );
    const now = new Date();
    const quarterStart = new Date(
      Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1),
    )
      .toISOString()
      .slice(0, 10);

    const { sections } = await getUnderTheHood({ seatId: null, groupId: group.group_id });
    const rows = rowsOf(section(sections, "plan_gaps"));
    const squads = await query<{ squad_id: number }>(
      "select squad_id from app.squads where group_id = $1",
      [group.group_id],
    );
    expect(rows).toHaveLength(squads.length);
    expect(rows.length).toBeGreaterThan(0);

    let checked = 0;
    for (const { squad_id } of squads) {
      const [expected] = await query<{
        open_seats: number;
        backfill_seats: number;
        committed: number;
        plan: number | null;
      }>(
        `select
           (select count(*) from app.seats where squad_id = $1 and status = 'open')::int as open_seats,
           (select count(*) from app.seats where squad_id = $1 and status = 'backfill')::int as backfill_seats,
           (select count(*) from app.seats where squad_id = $1
              and status in ('filled', 'offer_accepted'))::int as committed,
           (select approved_seats from app.headcount_plan
              where squad_id = $1 and quarter_start = $2::date) as plan`,
        [squad_id, quarterStart],
      );
      const row = rows.find((r) => r.squad_id === String(squad_id))!;
      expect(Number(row.open_seats)).toBe(expected.open_seats);
      expect(Number(row.backfill_seats)).toBe(expected.backfill_seats);
      if (expected.plan !== null) {
        expect(Number(row.approved_plan)).toBe(expected.plan);
        expect(Number(row.variance)).toBe(expected.committed - expected.plan);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // at least one squad has a current-quarter plan
  });
});

describe("Impact of last move", () => {
  type Counts = {
    filled_employee: number;
    filled_contingent: number;
    open_seats: number;
    backfill_seats: number;
    offer_accepted_seats: number;
  };

  // An independent count of one squad's seats, straight from app.seats.
  async function snapshot(squadId: number): Promise<Counts> {
    const [row] = await query<Counts>(
      `select
         count(*) filter (where status = 'filled' and seat_type = 'employee')::int as filled_employee,
         count(*) filter (where status = 'filled' and seat_type = 'contingent')::int as filled_contingent,
         count(*) filter (where status = 'open')::int as open_seats,
         count(*) filter (where status = 'backfill')::int as backfill_seats,
         count(*) filter (where status = 'offer_accepted')::int as offer_accepted_seats
       from app.seats where squad_id = $1`,
      [squadId],
    );
    return row;
  }

  const countsOf = (r: Record<string, string>): Counts => ({
    filled_employee: Number(r.filled_employee),
    filled_contingent: Number(r.filled_contingent),
    open_seats: Number(r.open_seats),
    backfill_seats: Number(r.backfill_seats),
    offer_accepted_seats: Number(r.offer_accepted_seats),
  });

  it("'before' equals a snapshot taken just before the move; 'after' is the live state", async () => {
    const [leaderRow] = await query<{ leader_id: number; group_id: number }>(
      "select leader_id, group_id from app.leaders where worker_id = $1",
      [GROUP_LEADER_WORKER],
    );
    const leader = (await findLeader(leaderRow.leader_id)) as Leader;

    const [mover] = await query<{
      seat_id: number;
      version: number;
      worker_id: string;
      squad_id: number;
    }>(
      `select s.seat_id, s.version, s.worker_id, s.squad_id
       from app.seats s
       join app.squads q on q.squad_id = s.squad_id
       join workday.workers w on w.worker_id = s.worker_id
       where q.group_id = $1 and s.seat_type = 'employee' and s.status = 'filled'
         and w.status = 'active' and w.worker_type = 'employee'
       order by s.seat_id limit 1`,
      [leaderRow.group_id],
    );
    const [target] = await query<{ seat_id: number; version: number; squad_id: number }>(
      `select s.seat_id, s.version, s.squad_id
       from app.seats s join app.squads q on q.squad_id = s.squad_id
       where q.group_id = $1 and s.seat_type = 'employee' and s.status = 'open'
         and s.squad_id <> $2
       order by s.seat_id limit 1`,
      [leaderRow.group_id, mover.squad_id],
    );

    const beforeA = await snapshot(mover.squad_id);
    const beforeB = await snapshot(target.squad_id);

    const result = await moveWorker(
      {
        workerId: mover.worker_id,
        fromSeatId: mover.seat_id,
        toSeatId: target.seat_id,
        effectiveDate: addUtcDays(utcToday(), 3),
        fromSeatVersion: mover.version,
        toSeatVersion: target.version,
      },
      leader,
    );
    expect(result.ok).toBe(true);

    const afterA = await snapshot(mover.squad_id);
    const afterB = await snapshot(target.squad_id);

    const { sections } = await getUnderTheHood({ seatId: null, groupId: null });
    const impact = rowsOf(section(sections, "last_move_impact"));
    expect(impact).toHaveLength(4); // two squads x before/after
    const pick = (squadId: number, phase: string) =>
      impact.find((r) => r.squad_id === String(squadId) && r.phase === phase)!;

    expect(countsOf(pick(mover.squad_id, "before"))).toEqual(beforeA);
    expect(countsOf(pick(target.squad_id, "before"))).toEqual(beforeB);
    expect(countsOf(pick(mover.squad_id, "after"))).toEqual(afterA);
    expect(countsOf(pick(target.squad_id, "after"))).toEqual(afterB);

    // The effect the move should have: A filled -1, backfill +1; B filled +1, open -1.
    expect(afterA.filled_employee).toBe(beforeA.filled_employee - 1);
    expect(afterA.backfill_seats).toBe(beforeA.backfill_seats + 1);
    expect(afterB.filled_employee).toBe(beforeB.filled_employee + 1);
    expect(afterB.open_seats).toBe(beforeB.open_seats - 1);

    // Variance is committed seats minus the current quarter's plan, so it moves with the counts.
    const committed = (c: Counts) =>
      c.filled_employee + c.filled_contingent + c.offer_accepted_seats;
    for (const [squadId, b, a] of [
      [mover.squad_id, beforeA, afterA],
      [target.squad_id, beforeB, afterB],
    ] as const) {
      const plan = Number(pick(squadId, "before").approved_plan);
      expect(Number(pick(squadId, "before").variance)).toBe(committed(b) - plan);
      expect(Number(pick(squadId, "after").variance)).toBe(committed(a) - plan);
    }
  });

  it("within-squad move into a backfill seat: 1 squad, before equals the pre-move snapshot", async () => {
    const [leaderRow] = await query<{ leader_id: number; group_id: number }>(
      "select leader_id, group_id from app.leaders where worker_id = $1",
      [GROUP_LEADER_WORKER],
    );
    const leader = (await findLeader(leaderRow.leader_id)) as Leader;

    // A squad in the group with an active employee in a filled seat and a second employee seat
    // that is open or backfill. Force it to backfill so the test is deterministic.
    const [pair] = await query<{ from_seat: number; to_seat: number; squad_id: number }>(
      `select f.seat_id as from_seat, t.seat_id as to_seat, f.squad_id
       from app.seats f
       join app.squads q on q.squad_id = f.squad_id
       join workday.workers w on w.worker_id = f.worker_id
       join app.seats t on t.squad_id = f.squad_id and t.seat_type = 'employee'
         and t.status in ('open', 'backfill')
       where q.group_id = $1 and f.seat_type = 'employee' and f.status = 'filled'
         and w.status = 'active' and w.worker_type = 'employee'
       order by f.seat_id, t.seat_id limit 1`,
      [leaderRow.group_id],
    );
    await query("update app.seats set status = 'backfill' where seat_id = $1", [pair.to_seat]);
    const [mover] = await query<{ version: number; worker_id: string }>(
      "select version, worker_id from app.seats where seat_id = $1",
      [pair.from_seat],
    );
    const [target] = await query<{ version: number }>(
      "select version from app.seats where seat_id = $1",
      [pair.to_seat],
    );

    const before = await snapshot(pair.squad_id);
    const result = await moveWorker(
      {
        workerId: mover.worker_id,
        fromSeatId: pair.from_seat,
        toSeatId: pair.to_seat,
        effectiveDate: addUtcDays(utcToday(), 3),
        fromSeatVersion: mover.version,
        toSeatVersion: target.version,
      },
      leader,
    );
    expect(result.ok).toBe(true);
    const after = await snapshot(pair.squad_id);

    const { sections } = await getUnderTheHood({ seatId: null, groupId: null });
    const impact = rowsOf(section(sections, "last_move_impact"));
    expect(impact).toHaveLength(2); // one squad x before/after
    const pick = (phase: string) => impact.find((r) => r.phase === phase)!;
    expect(countsOf(pick("before"))).toEqual(before);
    expect(countsOf(pick("after"))).toEqual(after);

    // Filled is unchanged. The vacated seat becomes backfill and the target leaves backfill, so
    // backfill and open counts are unchanged too, but the two seats swapped roles.
    expect(after.filled_employee).toBe(before.filled_employee);
    expect(after.backfill_seats).toBe(before.backfill_seats);
    expect(after.open_seats).toBe(before.open_seats);
    const [seats] = await query<{ from_status: string; to_status: string }>(
      `select (select status from app.seats where seat_id = $1) as from_status,
              (select status from app.seats where seat_id = $2) as to_status`,
      [pair.from_seat, pair.to_seat],
    );
    expect(seats).toEqual({ from_status: "backfill", to_status: "filled" });
  });
});
