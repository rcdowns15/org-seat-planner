import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTING_LEADER_COOKIE } from "@/lib/acting-as";
import { runSeed } from "../../scripts/seed/run-seed";

// Stand-in for the request cookie jar, for the server action tests (same as moves.test.ts).
let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === ACTING_LEADER_COOKIE && cookieValue !== undefined
        ? { name, value: cookieValue }
        : undefined,
  }),
}));

import { addUtcDays, utcToday } from "@/lib/dates";
import { findLeader } from "@/server/auth/acting-leader";
import { simulateAnotherLeaderEditAction } from "@/server/actions/demo";
import { getPool } from "@/server/db";
import { ANOTHER_LEADER_WORKER_ID, simulateAnotherLeaderEdit } from "@/server/services/demo-touch";
import { moveWorker } from "@/server/services/moves";
import { type Leader } from "@/server/services/permissions";

// Named fixtures from scripts/seed/README.md. Seats are found by attributes, not position.
const DIVISION_LEADER_WORKER = "100002"; // demo-division-leader
const GROUP_LEADER_WORKER = "100006"; // demo-group-leader: Digital Channels
const OUT_OF_SCOPE_OPEN_SEAT = 206; // out-of-scope-open-seat: in the division, outside the group

// These tests commit real rows, so the file starts and ends from a fresh seed.
beforeAll(async () => {
  await runSeed(process.env.DATABASE_URL!);
}, 60_000);
afterAll(async () => {
  await runSeed(process.env.DATABASE_URL!);
  await getPool().end();
}, 60_000);
afterEach(() => {
  vi.unstubAllEnvs();
  cookieValue = undefined;
});

type SeatRow = { seat_id: number; status: string; worker_id: string | null; version: number };
type ChangeRow = {
  change_type: string;
  actor_leader_id: number;
  effective_date: string;
  from_status: string;
  to_status: string;
  worker_id: string | null;
  note: string | null;
};

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
async function changesOn(seatId: number): Promise<ChangeRow[]> {
  return query<ChangeRow>(
    `select change_type, actor_leader_id, effective_date::text, from_status, to_status,
            worker_id, note
     from app.seat_changes where seat_id = $1 order by change_id`,
    [seatId],
  );
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

// A filled seat with an active employee, and an open seat in another squad, both in one group
// the division leader can edit (the demo group), found by attributes.
async function pickMovePair(groupId: number): Promise<{ from: SeatRow; to: SeatRow }> {
  const [from] = await query<SeatRow>(
    `select s.seat_id, s.status, s.worker_id, s.version
     from app.seats s join app.squads q on q.squad_id = s.squad_id
     join workday.workers w on w.worker_id = s.worker_id
     where q.group_id = $1 and s.seat_type = 'employee' and w.status = 'active'
       and w.worker_type = 'employee'
     order by s.seat_id limit 1`,
    [groupId],
  );
  const [to] = await query<SeatRow>(
    `select s.seat_id, s.status, s.worker_id, s.version
     from app.seats s join app.squads q on q.squad_id = s.squad_id
     where q.group_id = $1 and s.seat_type = 'employee' and s.status = 'open'
       and s.squad_id <> (select squad_id from app.seats where seat_id = $2)
     order by s.seat_id limit 1`,
    [groupId, from.seat_id],
  );
  return { from, to };
}

describe("simulate another leader's edit: DEMO_MODE gate (D-023)", () => {
  it("returns NOT_FOUND when DEMO_MODE is unset, and writes nothing", async () => {
    vi.stubEnv("DEMO_MODE", "");
    delete process.env.DEMO_MODE;
    const divisionLeader = await leaderByWorker(DIVISION_LEADER_WORKER);
    cookieValue = String(divisionLeader.leaderId);
    const [target] = await query<SeatRow>(
      `select s.seat_id, s.status, s.worker_id, s.version from app.seats s
       join app.squads q on q.squad_id = s.squad_id
       where q.group_id = (select group_id from app.leaders where worker_id = $1)
       order by s.seat_id limit 1`,
      [GROUP_LEADER_WORKER],
    );
    const seatBefore = await seat(target.seat_id);
    const changesBefore = await changeCount();

    const result = await simulateAnotherLeaderEditAction({ seatId: target.seat_id });

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await seat(target.seat_id)).toEqual(seatBefore);
    expect(await changeCount()).toBe(changesBefore);
  });

  it("returns NOT_FOUND for any value but 'true'", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    cookieValue = String((await leaderByWorker(DIVISION_LEADER_WORKER)).leaderId);
    const result = await simulateAnotherLeaderEditAction({ seatId: 1 });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("simulate another leader's edit: with DEMO_MODE=true", () => {
  it("bumps the version by 1 and appends a demo_touch row by 'Another leader'", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const divisionLeader = await leaderByWorker(DIVISION_LEADER_WORKER);
    cookieValue = String(divisionLeader.leaderId);
    const groupId = (await leaderByWorker(GROUP_LEADER_WORKER)).groupId!;
    const { from } = await pickMovePair(groupId);
    const before = await seat(from.seat_id);
    const [another] = await query<{ leader_id: number; display_name: string }>(
      "select leader_id, display_name from app.leaders where worker_id = $1",
      [ANOTHER_LEADER_WORKER_ID],
    );
    expect(another.leader_id).not.toBe(divisionLeader.leaderId);

    const result = await simulateAnotherLeaderEditAction({ seatId: from.seat_id });

    expect(result).toMatchObject({
      ok: true,
      seatId: from.seat_id,
      version: before.version + 1,
      effectiveDate: utcToday(),
      actorName: another.display_name,
    });
    // Seat: only the version moved (who sits where is unchanged).
    expect(await seat(from.seat_id)).toEqual({ ...before, version: before.version + 1 });
    // History: one demo_touch row, actor = Another leader (not the acting leader).
    const rows = await changesOn(from.seat_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      change_type: "demo_touch",
      actor_leader_id: another.leader_id,
      effective_date: utcToday(),
      from_status: before.status,
      to_status: before.status,
      worker_id: before.worker_id,
      note: `Simulated edit by another leader (demo), run by leader ${divisionLeader.leaderId}`,
    });
  });

  it("a move saved at the pre-simulate version is then a CONFLICT that writes nothing", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const divisionLeader = await leaderByWorker(DIVISION_LEADER_WORKER);
    cookieValue = String(divisionLeader.leaderId);
    const { to } = await pickMovePair((await leaderByWorker(GROUP_LEADER_WORKER)).groupId!);
    // A different mover than the one used above, whose seat still has its seeded version.
    const [mover] = await query<SeatRow>(
      `select s.seat_id, s.status, s.worker_id, s.version
       from app.seats s join app.squads q on q.squad_id = s.squad_id
       join workday.workers w on w.worker_id = s.worker_id
       where q.group_id = $1 and s.seat_type = 'employee' and w.status = 'active'
         and w.worker_type = 'employee' and s.version = 0 and s.squad_id <> (
           select squad_id from app.seats where seat_id = $2)
       order by s.seat_id limit 1`,
      [(await leaderByWorker(GROUP_LEADER_WORKER)).groupId!, to.seat_id],
    );
    const loaded = { to: to.version, from: mover.version };

    expect(await simulateAnotherLeaderEditAction({ seatId: to.seat_id })).toMatchObject({
      ok: true,
    });

    const changesBefore = await changeCount();
    const result = await moveWorker(
      {
        workerId: mover.worker_id,
        fromSeatId: mover.seat_id,
        toSeatId: to.seat_id,
        effectiveDate: utcToday(),
        fromSeatVersion: loaded.from,
        toSeatVersion: loaded.to,
      },
      divisionLeader,
    );
    expect(result).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await changeCount()).toBe(changesBefore);
    expect((await seat(mover.seat_id)).worker_id).toBe(mover.worker_id);

    // Refresh = reload the versions; the same move then saves.
    const fresh = await seat(to.seat_id);
    const retry = await moveWorker(
      {
        workerId: mover.worker_id,
        fromSeatId: mover.seat_id,
        toSeatId: to.seat_id,
        effectiveDate: utcToday(),
        fromSeatVersion: mover.version,
        toSeatVersion: fresh.version,
      },
      divisionLeader,
    );
    expect(retry).toMatchObject({ ok: true });
  });

  it("D-038: the touch row takes the date of a future-dated move on that seat", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const divisionLeader = await leaderByWorker(DIVISION_LEADER_WORKER);
    cookieValue = String(divisionLeader.leaderId);
    // Another group of the division, so earlier tests' moves don't interfere.
    const [otherGroup] = await query<{ group_id: number }>(
      `select g.group_id from app.groups g
       where g.division_id = $1 and g.group_id <> $2
       order by g.group_id limit 1`,
      [divisionLeader.divisionId, (await leaderByWorker(GROUP_LEADER_WORKER)).groupId],
    );
    const { from, to } = await pickMovePair(otherGroup.group_id);
    const futureDate = addUtcDays(utcToday(), 10);
    const moved = await moveWorker(
      {
        workerId: from.worker_id!,
        fromSeatId: from.seat_id,
        toSeatId: to.seat_id,
        effectiveDate: futureDate,
        fromSeatVersion: from.version,
        toSeatVersion: to.version,
      },
      divisionLeader,
    );
    expect(moved.ok).toBe(true);

    // The target seat (now holding the worker) and the vacated seat both carry the move's date.
    for (const seatId of [to.seat_id, from.seat_id]) {
      const before = await seat(seatId);
      const result = await simulateAnotherLeaderEditAction({ seatId });
      expect(result).toMatchObject({ ok: true, effectiveDate: futureDate });
      const rows = await changesOn(seatId);
      const touch = rows.find((r) => r.change_type === "demo_touch")!;
      expect(touch.effective_date).toBe(futureDate);
      expect(rows.every((r) => r.effective_date <= touch.effective_date)).toBe(true);
      expect((await seat(seatId)).version).toBe(before.version + 1);
    }
  });

  it("D-038: a clock earlier than the seat's latest change never backdates the row", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const divisionLeader = await leaderByWorker(DIVISION_LEADER_WORKER);
    cookieValue = String(divisionLeader.leaderId);
    const { from } = await pickMovePair((await leaderByWorker(GROUP_LEADER_WORKER)).groupId!);
    // Its own prior row: a touch dated today. The injected clock is months earlier, so the
    // later of the two (today) must win.
    expect(await simulateAnotherLeaderEditAction({ seatId: from.seat_id })).toMatchObject({
      ok: true,
      effectiveDate: utcToday(),
    });
    const result = await simulateAnotherLeaderEdit(from.seat_id, divisionLeader, {
      now: new Date(Date.UTC(2026, 5, 1)),
    });
    expect(result).toMatchObject({ ok: true, effectiveDate: utcToday() });
  });

  it("D-038: the touch row takes a later date recorded for the seated worker on another seat", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const divisionLeader = await leaderByWorker(DIVISION_LEADER_WORKER);
    cookieValue = String(divisionLeader.leaderId);
    const groupId = (await leaderByWorker(GROUP_LEADER_WORKER)).groupId!;
    const { from, to } = await pickMovePair(groupId);
    const [another] = await query<{ leader_id: number }>(
      "select leader_id from app.leaders where worker_id = $1",
      [ANOTHER_LEADER_WORKER_ID],
    );
    // A later-dated row for the worker, but on a different seat (the open one).
    const laterDate = addUtcDays(utcToday(), 20);
    await query(
      `insert into app.seat_changes
         (seat_id, change_type, worker_id, from_status, to_status, from_worker_id,
          to_worker_id, actor_leader_id, effective_date)
       values ($1, 'demo_touch', $2, 'filled', 'filled', $2, $2, $3, $4)`,
      [to.seat_id, from.worker_id, another.leader_id, laterDate],
    );

    const result = await simulateAnotherLeaderEditAction({ seatId: from.seat_id });

    expect(result).toMatchObject({ ok: true, effectiveDate: laterDate });
    const touch = (await changesOn(from.seat_id)).filter((r) => r.change_type === "demo_touch");
    expect(touch.at(-1)!.effective_date).toBe(laterDate);
  });

  it("READ_ONLY with no acting leader; nothing written", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const changesBefore = await changeCount();
    const result = await simulateAnotherLeaderEditAction({ seatId: OUT_OF_SCOPE_OPEN_SEAT });
    expect(result).toMatchObject({ ok: false, code: "READ_ONLY" });
    expect(await changeCount()).toBe(changesBefore);
  });

  it("FORBIDDEN: the group leader can't simulate on a seat outside their group", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    cookieValue = String((await leaderByWorker(GROUP_LEADER_WORKER)).leaderId);
    const before = await seat(OUT_OF_SCOPE_OPEN_SEAT);
    const changesBefore = await changeCount();
    const result = await simulateAnotherLeaderEditAction({ seatId: OUT_OF_SCOPE_OPEN_SEAT });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await seat(OUT_OF_SCOPE_OPEN_SEAT)).toEqual(before);
    expect(await changeCount()).toBe(changesBefore);
  });

  it("INVALID_INPUT: a bad seat id; a spoofed leader field is ignored", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const divisionLeader = await leaderByWorker(DIVISION_LEADER_WORKER);
    cookieValue = String(divisionLeader.leaderId);
    expect(await simulateAnotherLeaderEditAction({ seatId: "x" })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await simulateAnotherLeaderEditAction({ seatId: -1 })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });

    // A spoofed leader id in the input is ignored: the result follows the cookie leader. The
    // group leader (cookie) can't edit an out-of-scope seat even when the input names the
    // division leader, who can.
    const groupLeader = await leaderByWorker(GROUP_LEADER_WORKER);
    cookieValue = String(groupLeader.leaderId);
    const changesBefore = await changeCount();
    const spoofed = await simulateAnotherLeaderEditAction({
      seatId: OUT_OF_SCOPE_OPEN_SEAT,
      leaderId: divisionLeader.leaderId,
    });
    expect(spoofed).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await changeCount()).toBe(changesBefore);
  });
});

describe("a leader who can edit no squad", () => {
  const nobody: Leader = {
    leaderId: 9_999_999,
    workerId: "nobody",
    displayName: "Nobody",
    scopeType: "group",
    divisionId: null,
    groupId: 9_999_999, // no such group
  };

  it("the server still rejects their move with FORBIDDEN, writing nothing", async () => {
    const { from, to } = await pickMovePair((await leaderByWorker(GROUP_LEADER_WORKER)).groupId!);
    const changesBefore = await changeCount();
    const result = await moveWorker(
      {
        workerId: from.worker_id!,
        fromSeatId: from.seat_id,
        toSeatId: to.seat_id,
        effectiveDate: utcToday(),
        fromSeatVersion: from.version,
        toSeatVersion: to.version,
      },
      nobody,
    );
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await changeCount()).toBe(changesBefore);
  });
});
