import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getPool } from "@/server/db";
import { ACTING_LEADER_COOKIE } from "@/lib/acting-as";

// Stand-in for the request cookie jar; each test sets `cookieValue` before calling the code.
let cookieValue: string | undefined;
const cookieStore = {
  get: (name: string) =>
    name === ACTING_LEADER_COOKIE && cookieValue !== undefined
      ? { name, value: cookieValue }
      : undefined,
  set: vi.fn((_name: string, value: string) => {
    cookieValue = value;
  }),
  delete: vi.fn(() => {
    cookieValue = undefined;
  }),
};
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

import {
  getActingLeader,
  findLeader,
  resolveLeaderFromCookieValue,
} from "@/server/auth/acting-leader";
import { canEditSquad, requireEditSquads, type Leader } from "@/server/services/permissions";
import { setActingLeader } from "@/server/actions/acting-as";
import { runMutation } from "@/server/actions/run-mutation";

// Named fixtures from scripts/seed/README.md (worker ids and seat id, never row positions).
const DIVISION_LEADER_WORKER = "100002"; // demo-division-leader: Retail Banking Technology
const GROUP_LEADER_WORKER = "100006"; // demo-group-leader: Digital Channels
const OUT_OF_SCOPE_OPEN_SEAT = 206; // out-of-scope-open-seat

afterAll(() => getPool().end());

type SquadRow = { squad_id: number; group_id: number; division_id: number };

async function leaderByWorker(workerId: string): Promise<Leader> {
  const { rows } = await getPool().query<{ leader_id: number }>(
    "select leader_id from app.leaders where worker_id = $1",
    [workerId],
  );
  const leader = await findLeader(rows[0].leader_id);
  if (!leader) throw new Error(`no leader for worker ${workerId}`);
  return leader;
}

describe("canEditSquad: division and group scopes (D-013, D-030)", () => {
  let allSquads: SquadRow[];
  let divisionLeader: Leader;
  let groupLeader: Leader;

  beforeAll(async () => {
    const { rows } = await getPool().query<SquadRow>(
      `select s.squad_id, s.group_id, g.division_id
         from app.squads s join app.groups g using (group_id) order by s.squad_id`,
    );
    allSquads = rows;
    divisionLeader = await leaderByWorker(DIVISION_LEADER_WORKER);
    groupLeader = await leaderByWorker(GROUP_LEADER_WORKER);
  });

  it("the fixtures have the scopes the seed README promises", () => {
    expect(divisionLeader.scopeType).toBe("division");
    expect(groupLeader.scopeType).toBe("group");
    // Same division, and the group leader's group is inside it.
    const groupSquad = allSquads.find((s) => s.group_id === groupLeader.groupId)!;
    expect(groupSquad.division_id).toBe(divisionLeader.divisionId);
  });

  it("division leader edits every squad in their division and none outside", async () => {
    const inside = allSquads.filter((s) => s.division_id === divisionLeader.divisionId);
    const outside = allSquads.filter((s) => s.division_id !== divisionLeader.divisionId);
    expect(inside.length).toBeGreaterThan(0);
    expect(outside.length).toBeGreaterThan(0);
    for (const s of inside) expect(await canEditSquad(divisionLeader, s.squad_id)).toBe(true);
    for (const s of outside) expect(await canEditSquad(divisionLeader, s.squad_id)).toBe(false);
  });

  it("group leader edits only their group's squads", async () => {
    const inside = allSquads.filter((s) => s.group_id === groupLeader.groupId);
    const outside = allSquads.filter((s) => s.group_id !== groupLeader.groupId);
    expect(inside.length).toBeGreaterThan(0);
    for (const s of inside) expect(await canEditSquad(groupLeader, s.squad_id)).toBe(true);
    // Includes sibling groups in the same division.
    for (const s of outside) expect(await canEditSquad(groupLeader, s.squad_id)).toBe(false);
  });

  it("out-of-scope-open-seat's squad: division leader yes, group leader no", async () => {
    const { rows } = await getPool().query<{ squad_id: number }>(
      "select squad_id from app.seats where seat_id = $1",
      [OUT_OF_SCOPE_OPEN_SEAT],
    );
    const squadId = rows[0].squad_id;
    expect(await canEditSquad(divisionLeader, squadId)).toBe(true);
    expect(await canEditSquad(groupLeader, squadId)).toBe(false);
  });

  it("no leader and unknown squads are not editable", async () => {
    expect(await canEditSquad(null, allSquads[0].squad_id)).toBe(false);
    expect(await canEditSquad(divisionLeader, -1)).toBe(false);
    expect(await canEditSquad(divisionLeader, 2_000_000_000)).toBe(false);
  });

  it("a multi-squad mutation needs permission on every squad it touches", async () => {
    const inGroup = allSquads.find((s) => s.group_id === groupLeader.groupId)!;
    const sibling = allSquads.find(
      (s) => s.division_id === divisionLeader.divisionId && s.group_id !== groupLeader.groupId,
    )!;
    expect(await requireEditSquads(groupLeader, [inGroup.squad_id, inGroup.squad_id])).toEqual({
      ok: true,
    });
    const denied = await requireEditSquads(groupLeader, [inGroup.squad_id, sibling.squad_id]);
    expect(denied).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await requireEditSquads(divisionLeader, [inGroup.squad_id, sibling.squad_id])).toEqual({
      ok: true,
    });
    expect(await requireEditSquads(null, [inGroup.squad_id])).toMatchObject({
      ok: false,
      code: "READ_ONLY",
    });
  });
});

describe("acting leader cookie", () => {
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["non-numeric", "abc"],
    ["trailing junk", "1abc"],
    ["negative", "-1"],
    ["decimal", "1.5"],
    ["exponent", "1e3"],
    ["leading zero", "01"],
    ["whitespace", " 1"],
    ["too large for integer", "99999999999999"],
    ["unknown id", "2000000000"],
    ["SQL-looking", "1 OR 1=1"],
  ])("%s cookie yields read-only mode (null leader)", async (_label, value) => {
    cookieValue = value;
    expect(await getActingLeader()).toBeNull();
    expect(await resolveLeaderFromCookieValue(value)).toBeNull();
  });

  it("a valid cookie resolves to that leader from app.leaders", async () => {
    const leader = await leaderByWorker(GROUP_LEADER_WORKER);
    cookieValue = String(leader.leaderId);
    expect(await getActingLeader()).toEqual(leader);
  });

  it("setActingLeader sets the cookie for a real leader, rejects bad input, and clears on ''", async () => {
    const leader = await leaderByWorker(DIVISION_LEADER_WORKER);
    cookieValue = undefined;
    expect(await setActingLeader({ leaderId: String(leader.leaderId) })).toEqual({ ok: true });
    expect(cookieValue).toBe(String(leader.leaderId));

    expect(await setActingLeader({ leaderId: "2000000000" })).toMatchObject({
      ok: false,
      code: "UNKNOWN_LEADER",
    });
    expect(await setActingLeader({ leaderId: "abc" })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await setActingLeader(null)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(cookieValue).toBe(String(leader.leaderId)); // failures didn't change it

    expect(await setActingLeader({ leaderId: "" })).toEqual({ ok: true });
    expect(cookieValue).toBeUndefined();
  });
});

describe("runMutation: the leader comes from the cookie, never from input", () => {
  // A sample mutation schema, as every real mutation will define one.
  const schema = z.object({ squadId: z.number().int() });
  const handler = async (input: { squadId: number }, leader: Leader) => ({
    ok: true as const,
    seenInput: input,
    actingLeaderId: leader.leaderId,
  });

  it("ignores a spoofed leader id in the input", async () => {
    const real = await leaderByWorker(GROUP_LEADER_WORKER);
    const victim = await leaderByWorker(DIVISION_LEADER_WORKER);
    cookieValue = String(real.leaderId);

    const result = await runMutation(
      schema,
      { squadId: 1, leaderId: victim.leaderId, actingLeaderId: victim.leaderId },
      handler,
    );
    expect(result).toEqual({
      ok: true,
      seenInput: { squadId: 1 }, // spoofed fields stripped by Zod
      actingLeaderId: real.leaderId, // from the cookie
    });
  });

  it("returns READ_ONLY with no valid cookie, even if the input names a leader", async () => {
    const victim = await leaderByWorker(DIVISION_LEADER_WORKER);
    cookieValue = "garbage";
    const result = await runMutation(schema, { squadId: 1, leaderId: victim.leaderId }, handler);
    expect(result).toMatchObject({ ok: false, code: "READ_ONLY" });
  });

  it("returns INVALID_INPUT for input that fails the schema", async () => {
    const real = await leaderByWorker(GROUP_LEADER_WORKER);
    cookieValue = String(real.leaderId);
    expect(await runMutation(schema, { squadId: "x" }, handler)).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
  });
});
