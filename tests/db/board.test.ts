import { describe, expect, it } from "vitest";
import { getPool } from "@/server/db";
import { DEFAULT_GROUP_NAME, getBoard } from "@/server/queries/board";

describe("getBoard", () => {
  it("defaults to Digital Channels, the group of demo-group-leader", async () => {
    const board = await getBoard(null);
    const { rows } = await getPool().query(
      `select g.name from app.leaders l join app.groups g on g.group_id = l.group_id
       where l.worker_id = $1`,
      ["100006"],
    );
    expect(DEFAULT_GROUP_NAME).toBe(rows[0].name);
    expect(board?.group.name).toBe(rows[0].name);
  });

  it("returns every seat of every squad in the group, with workers for filled seats", async () => {
    const board = await getBoard(null);
    const { rows } = await getPool().query(
      `select count(*)::int n from app.seats s join app.squads q on q.squad_id = s.squad_id
       where q.group_id = $1`,
      [board!.group.groupId],
    );
    expect(board!.squads.flatMap((s) => s.seats)).toHaveLength(rows[0].n);
    for (const seat of board!.squads.flatMap((s) => s.seats)) {
      if (seat.status === "filled") expect(seat.workerName).not.toBeNull();
      else expect(seat.workerId).toBeNull();
    }
  });

  it("returns null for an unknown group", async () => {
    expect(await getBoard(999999)).toBeNull();
  });

  it("squad header counts match SQL: filled seats and all seats per squad", async () => {
    const board = await getBoard(null);
    const { rows } = await getPool().query<{ squad_id: number; filled: number; approved: number }>(
      `select s.squad_id, (count(*) filter (where s.status = 'filled'))::int filled,
              count(*)::int approved
       from app.seats s join app.squads q on q.squad_id = s.squad_id
       where q.group_id = $1 group by s.squad_id`,
      [board!.group.groupId],
    );
    const expected = new Map(rows.map((r) => [r.squad_id, r]));
    expect(board!.squads.length).toBeGreaterThan(0);
    for (const squad of board!.squads) {
      const e = expected.get(squad.squadId);
      expect(squad.filledCount).toBe(e?.filled ?? 0);
      expect(squad.approvedCount).toBe(e?.approved ?? 0);
    }
    expect(board!.squads.reduce((n, s) => n + s.approvedCount, 0)).toBeGreaterThan(0);
  });

  it("still renders a terminated worker who holds a seat (reconciliation exception)", async () => {
    const { rows } = await getPool().query(
      `select q.group_id from app.seats s join app.squads q on q.squad_id = s.squad_id
       where s.worker_id = $1`,
      ["100052"],
    );
    const board = await getBoard(rows[0].group_id);
    const seat = board!.squads.flatMap((s) => s.seats).find((s) => s.workerId === "100052");
    expect(seat?.workerStatus).toBe("terminated");
  });
});
