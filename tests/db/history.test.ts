import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "@/server/db";
import { getSeatHistory } from "@/server/queries/history";
import { runSeed } from "../../scripts/seed/run-seed";

// The rows are inserted directly with chosen created_at values, so the order test controls "when
// it was saved" exactly. The file starts and ends from a fresh seed, like moves.test.ts.
beforeAll(async () => {
  await runSeed(process.env.DATABASE_URL!);
}, 60_000);
afterAll(async () => {
  await runSeed(process.env.DATABASE_URL!);
  await getPool().end();
}, 60_000);

async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await getPool().query(text, values)).rows as T[];
}

type ChangeSpec = {
  seatId: number;
  type: string;
  from: string;
  to: string;
  fromWorker: string | null;
  toWorker: string | null;
  createdAt: string;
};

async function insertChange(leaderId: number, c: ChangeSpec): Promise<number> {
  const [row] = await query<{ change_id: string }>(
    `insert into app.seat_changes
       (seat_id, change_type, worker_id, from_status, to_status, from_worker_id, to_worker_id,
        actor_leader_id, effective_date, created_at)
     values ($1, $2, coalesce($5, $6), $3, $4, $5, $6, $7, '2026-12-01', $8)
     returning change_id`,
    [c.seatId, c.type, c.from, c.to, c.fromWorker, c.toWorker, leaderId, c.createdAt],
  );
  return Number(row.change_id);
}

describe("getSeatHistory", () => {
  it("returns one seat's rows newest first, ties broken by change_id descending, and no other seat's rows", async () => {
    const [leader] = await query<{ leader_id: number; display_name: string }>(
      "select leader_id, display_name from app.leaders order by leader_id limit 1",
    );
    const [seatA, seatB] = await query<{ seat_id: number }>(
      "select seat_id from app.seats order by seat_id limit 2",
    );
    const [worker] = await query<{ worker_id: string; first_name: string; last_name: string }>(
      "select worker_id, first_name, last_name from workday.workers order by worker_id limit 1",
    );
    const A = seatA.seat_id;
    const base = { seatId: A, fromWorker: null, toWorker: null };

    // Inserted out of time order on purpose, so neither insert order nor change_id order alone
    // gives the expected result. The last two share one created_at (a tie).
    const t2 = await insertChange(leader.leader_id, {
      ...base,
      type: "release",
      from: "offer_accepted",
      to: "open",
      createdAt: "2026-11-10T10:00:00Z",
    });
    const t1 = await insertChange(leader.leader_id, {
      ...base,
      type: "reserve",
      from: "open",
      to: "offer_accepted",
      createdAt: "2026-11-09T10:00:00Z",
    });
    const tieFirst = await insertChange(leader.leader_id, {
      ...base,
      type: "vacate",
      from: "filled",
      to: "backfill",
      fromWorker: worker.worker_id,
      createdAt: "2026-11-11T10:00:00Z",
    });
    const tieSecond = await insertChange(leader.leader_id, {
      ...base,
      type: "fill",
      from: "backfill",
      to: "filled",
      toWorker: worker.worker_id,
      createdAt: "2026-11-11T10:00:00Z",
    });
    await insertChange(leader.leader_id, {
      seatId: seatB.seat_id,
      fromWorker: null,
      toWorker: null,
      type: "reserve",
      from: "open",
      to: "offer_accepted",
      createdAt: "2026-11-12T10:00:00Z",
    });

    const history = await getSeatHistory(A);
    expect(history.map((h) => h.changeId)).toEqual([tieSecond, tieFirst, t2, t1]);

    const fill = history[0];
    expect(fill.changeType).toBe("fill");
    expect(fill.fromStatus).toBe("backfill");
    expect(fill.toStatus).toBe("filled");
    expect(fill.fromWorkerName).toBeNull();
    expect(fill.toWorkerName).toBe(`${worker.first_name} ${worker.last_name}`);
    expect(fill.actorName).toBe(leader.display_name);
    expect(fill.savedAt).toBe("2026-11-11T10:00:00.000Z");
    expect(fill.effectiveDate).toBe("2026-12-01");
    expect(history[1].fromWorkerName).toBe(`${worker.first_name} ${worker.last_name}`);

    // The other seat has its own single row.
    const other = await getSeatHistory(seatB.seat_id);
    expect(other).toHaveLength(1);
    expect(other[0].changeType).toBe("reserve");
  });

  it("returns no rows for a seat with no changes, and for an invalid seat id", async () => {
    const [{ seat_id }] = await query<{ seat_id: number }>(
      `select seat_id from app.seats s
       where not exists (select 1 from app.seat_changes c where c.seat_id = s.seat_id)
       order by seat_id limit 1`,
    );
    expect(await getSeatHistory(seat_id)).toEqual([]);
    expect(await getSeatHistory(-1)).toEqual([]);
    expect(await getSeatHistory("1; drop table app.seats")).toEqual([]);
    expect(await getSeatHistory(1.5)).toEqual([]);
  });

  it("the seat_id index exists and the history lookup can use it", async () => {
    const client = await getPool().connect();
    try {
      // The table is small, so force the planner off a sequential scan to see that the index
      // matches the query's seat_id predicate.
      await client.query("set enable_seqscan = off");
      const plan = await client.query(
        "explain select change_id from app.seat_changes where seat_id = $1 order by created_at desc, change_id desc",
        [1],
      );
      const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
      expect(text).toContain("seat_changes_seat_id_idx");
    } finally {
      await client.query("reset enable_seqscan"); // the connection goes back to the pool
      client.release();
    }
  });
});
