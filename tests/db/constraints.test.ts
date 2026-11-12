import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { getPool } from "@/server/db";
import { expectSqlState, insertFixture, insertSeat, withRollback } from "./helpers";

// SQLSTATEs: 23505 unique_violation, 23514 check_violation, P0001 raise_exception (our trigger).

afterAll(async () => {
  await getPool().end();
});

async function insertChange(
  client: PoolClient,
  seatId: number,
  leaderId: number,
  extra: { changeType?: string; reversesChangeId?: number | null } = {},
): Promise<number> {
  const res = await client.query<{ change_id: string }>(
    `insert into app.seat_changes
       (seat_id, change_type, from_status, to_status, actor_leader_id, effective_date,
        reverses_change_id)
     values ($1, $2, 'open', 'backfill', $3, current_date, $4)
     returning change_id`,
    [seatId, extra.changeType ?? "demo_touch", leaderId, extra.reversesChangeId ?? null],
  );
  return Number(res.rows[0].change_id);
}

describe("app.seats constraints", () => {
  it("rejects a second seat for the same worker (no double-seating)", async () => {
    await withRollback(async (client) => {
      const { squadId, suffix } = await insertFixture(client);
      const workerId = `test-worker-${suffix}`;
      await insertSeat(client, squadId, "filled", workerId);
      const err = await expectSqlState(
        client,
        "23505",
        `insert into app.seats (squad_id, seat_type, status, worker_id)
         values ($1, 'employee', 'filled', $2)`,
        [squadId, workerId],
      );
      expect(err.constraint).toBe("seats_worker_id_key");
    });
  });

  it("allows many seats without a worker (the unique index is partial)", async () => {
    await withRollback(async (client) => {
      const { squadId } = await insertFixture(client);
      await insertSeat(client, squadId, "open", null);
      await insertSeat(client, squadId, "backfill", null);
      await insertSeat(client, squadId, "offer_accepted", null);
    });
  });

  it("rejects an invalid status", async () => {
    await withRollback(async (client) => {
      const { squadId } = await insertFixture(client);
      const err = await expectSqlState(
        client,
        "23514",
        `insert into app.seats (squad_id, seat_type, status) values ($1, 'employee', 'vacant')`,
        [squadId],
      );
      expect(err.constraint).toBe("seats_status_check");
    });
  });

  it("rejects a filled seat with no worker, and an open seat with one", async () => {
    await withRollback(async (client) => {
      const { squadId, suffix } = await insertFixture(client);
      const filledNoWorker = await expectSqlState(
        client,
        "23514",
        `insert into app.seats (squad_id, seat_type, status, worker_id)
         values ($1, 'employee', 'filled', null)`,
        [squadId],
      );
      expect(filledNoWorker.constraint).toBe("seats_filled_has_worker_check");
      const openWithWorker = await expectSqlState(
        client,
        "23514",
        `insert into app.seats (squad_id, seat_type, status, worker_id)
         values ($1, 'employee', 'open', $2)`,
        [squadId, `test-worker-${suffix}`],
      );
      expect(openWithWorker.constraint).toBe("seats_filled_has_worker_check");
    });
  });

  it("rejects an invalid seat type", async () => {
    await withRollback(async (client) => {
      const { squadId } = await insertFixture(client);
      const err = await expectSqlState(
        client,
        "23514",
        `insert into app.seats (squad_id, seat_type, status) values ($1, 'intern', 'open')`,
        [squadId],
      );
      expect(err.constraint).toBe("seats_seat_type_check");
    });
  });

  it("starts every seat at version 0", async () => {
    await withRollback(async (client) => {
      const { squadId } = await insertFixture(client);
      const seatId = await insertSeat(client, squadId, "open", null);
      const res = await client.query("select version from app.seats where seat_id = $1", [seatId]);
      expect(res.rows[0].version).toBe(0);
    });
  });
});

describe("app.seat_changes is append-only", () => {
  it("raises on UPDATE", async () => {
    await withRollback(async (client) => {
      const { squadId, leaderId } = await insertFixture(client);
      const seatId = await insertSeat(client, squadId, "backfill", null);
      const changeId = await insertChange(client, seatId, leaderId);
      const err = await expectSqlState(
        client,
        "P0001",
        "update app.seat_changes set note = 'edited' where change_id = $1",
        [changeId],
      );
      expect(err.message).toMatch(/append-only: UPDATE/);
    });
  });

  it("raises on DELETE", async () => {
    await withRollback(async (client) => {
      const { squadId, leaderId } = await insertFixture(client);
      const seatId = await insertSeat(client, squadId, "backfill", null);
      const changeId = await insertChange(client, seatId, leaderId);
      const err = await expectSqlState(
        client,
        "P0001",
        "delete from app.seat_changes where change_id = $1",
        [changeId],
      );
      expect(err.message).toMatch(/append-only: DELETE/);
    });
  });

  it("raises on TRUNCATE unless the seed's reset setting is on for the transaction", async () => {
    await withRollback(async (client) => {
      const err = await expectSqlState(client, "P0001", "truncate app.seat_changes");
      expect(err.message).toMatch(/append-only: TRUNCATE/);
      // The seed's reset path: SET LOCAL scopes the escape hatch to this (rolled-back) transaction.
      await client.query("set local app.allow_seat_changes_reset = 'on'");
      await client.query("truncate app.seat_changes");
    });
  });

  it("allows a change to be reversed only once", async () => {
    await withRollback(async (client) => {
      const { squadId, leaderId } = await insertFixture(client);
      const seatId = await insertSeat(client, squadId, "backfill", null);
      const changeId = await insertChange(client, seatId, leaderId);
      await insertChange(client, seatId, leaderId, {
        changeType: "undo",
        reversesChangeId: changeId,
      });
      const err = await expectSqlState(
        client,
        "23505",
        `insert into app.seat_changes
           (seat_id, change_type, from_status, to_status, actor_leader_id, effective_date,
            reverses_change_id)
         values ($1, 'undo', 'backfill', 'open', $2, current_date, $3)`,
        [seatId, leaderId, changeId],
      );
      expect(err.constraint).toBe("seat_changes_reverses_change_id_key");
    });
  });

  it("rejects a move row without a move_id and an unknown change type", async () => {
    await withRollback(async (client) => {
      const { squadId, leaderId } = await insertFixture(client);
      const seatId = await insertSeat(client, squadId, "backfill", null);
      const noMoveId = await expectSqlState(
        client,
        "23514",
        `insert into app.seat_changes
           (seat_id, change_type, from_status, to_status, actor_leader_id, effective_date)
         values ($1, 'move_in', 'open', 'backfill', $2, current_date)`,
        [seatId, leaderId],
      );
      expect(noMoveId.constraint).toBe("seat_changes_move_has_move_id_check");
      const badType = await expectSqlState(
        client,
        "23514",
        `insert into app.seat_changes
           (seat_id, change_type, from_status, to_status, actor_leader_id, effective_date)
         values ($1, 'teleport', 'open', 'backfill', $2, current_date)`,
        [seatId, leaderId],
      );
      expect(badType.constraint).toBe("seat_changes_change_type_check");
    });
  });
});

describe("other app constraints", () => {
  it("requires a leader's scope column to match scope_type", async () => {
    await withRollback(async (client) => {
      const { suffix } = await insertFixture(client);
      const err = await expectSqlState(
        client,
        "23514",
        `insert into app.leaders (worker_id, display_name, scope_type)
         values ($1, 'No Scope', 'group')`,
        [`test-leader-2-${suffix}`],
      );
      expect(err.constraint).toBe("leaders_scope_matches_type_check");
    });
  });

  it("only accepts quarter start dates in the headcount plan", async () => {
    await withRollback(async (client) => {
      const { squadId } = await insertFixture(client);
      await client.query(
        "insert into app.headcount_plan (squad_id, quarter_start, approved_seats) values ($1, '2026-10-01', 5)",
        [squadId],
      );
      const err = await expectSqlState(
        client,
        "23514",
        "insert into app.headcount_plan (squad_id, quarter_start, approved_seats) values ($1, '2026-11-01', 5)",
        [squadId],
      );
      expect(err.constraint).toBe("headcount_plan_quarter_start_check");
    });
  });
});

describe("workday.workers constraints", () => {
  async function insertWorker(
    client: PoolClient,
    workerId: string,
    status: string,
    positionId: string,
  ): Promise<void> {
    await client.query(
      `insert into workday.workers
         (worker_id, first_name, last_name, email, worker_type, status, hire_date,
          termination_date, job_title, supervisory_org, position_id, cost_center, location,
          as_of_report_date)
       values ($1, 'Test', 'Worker', $2, 'employee', $3, '2024-01-15',
               case when $3 = 'terminated' then '2026-10-01'::date end,
               'Engineer', 'Test Org', $4, 'CC-0000 Test', 'Remote', '2026-11-01')`,
      [workerId, `${workerId}@example.test`, status, positionId],
    );
  }

  it("keeps position_id unique among non-terminated workers only", async () => {
    await withRollback(async (client) => {
      const { suffix } = await insertFixture(client);
      const position = `P-TEST-${suffix}`;
      await insertWorker(client, `test-w1-${suffix}`, "terminated", position);
      await insertWorker(client, `test-w2-${suffix}`, "active", position); // reuse after a termination
      const err = await expectSqlState(
        client,
        "23505",
        `insert into workday.workers
           (worker_id, first_name, last_name, email, worker_type, status, hire_date, job_title,
            supervisory_org, position_id, cost_center, location, as_of_report_date)
         values ($1, 'Test', 'Worker', 'x@example.test', 'employee', 'leave', '2024-01-15',
                 'Engineer', 'Test Org', $2, 'CC-0000 Test', 'Remote', '2026-11-01')`,
        [`test-w3-${suffix}`, position],
      );
      expect(err.constraint).toBe("workers_position_id_active_key");
    });
  });

  it("rejects an invalid status", async () => {
    await withRollback(async (client) => {
      const { suffix } = await insertFixture(client);
      const err = await expectSqlState(
        client,
        "23514",
        `insert into workday.workers
           (worker_id, first_name, last_name, email, worker_type, status, hire_date, job_title,
            supervisory_org, position_id, cost_center, location, as_of_report_date)
         values ($1, 'Test', 'Worker', 'x@example.test', 'employee', 'On Leave', '2024-01-15',
                 'Engineer', 'Test Org', 'P-X', 'CC-0000 Test', 'Remote', '2026-11-01')`,
        [`test-w4-${suffix}`],
      );
      expect(err.constraint).toBe("workers_status_check");
    });
  });
});

describe("D-029 columns", () => {
  async function columnsOf(schema: string, table: string): Promise<string[]> {
    const res = await getPool().query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = $1 and table_name = $2`,
      [schema, table],
    );
    return res.rows.map((r) => r.column_name);
  }

  it("workday.workers has position_id, cost_center and location", async () => {
    const columns = await columnsOf("workday", "workers");
    expect(columns).toEqual(expect.arrayContaining(["position_id", "cost_center", "location"]));
  });

  it("app.seats has no position column (seats match Workday by worker_id only)", async () => {
    const columns = await columnsOf("app", "seats");
    expect(columns).toContain("worker_id");
    expect(columns.filter((c) => c.includes("position"))).toEqual([]);
  });
});
