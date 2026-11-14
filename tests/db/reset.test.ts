import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTING_LEADER_COOKIE } from "@/lib/acting-as";
import { checkSeed, runSeed } from "../../scripts/seed/run-seed";

// Stand-in for the request cookie jar (same as demo.test.ts).
let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === ACTING_LEADER_COOKIE && cookieValue !== undefined
        ? { name, value: cookieValue }
        : undefined,
  }),
}));
// The action revalidates pages; outside a Next request there is nothing to revalidate.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { utcToday } from "@/lib/dates";
import { findLeader } from "@/server/auth/acting-leader";
import { resetDemoDataAction } from "@/server/actions/demo";
import { getPool } from "@/server/db";
import { resetDemoData } from "@/server/services/demo-reset";
import { simulateAnotherLeaderEdit } from "@/server/services/demo-touch";
import { moveWorker } from "@/server/services/moves";

const DIVISION_LEADER_WORKER = "100002"; // demo-division-leader (scripts/seed/README.md)
const OUT_OF_SCOPE_OPEN_SEAT = 206; // out-of-scope-open-seat, inside the division leader's scope

let baseline: string;

// Every test starts from a fresh full seed (which also clears the reset throttle row).
beforeAll(async () => {
  baseline = (await runSeed(process.env.DATABASE_URL!)).checksum;
}, 60_000);
beforeEach(async () => {
  await runSeed(process.env.DATABASE_URL!);
}, 60_000);
afterEach(() => {
  vi.unstubAllEnvs();
  cookieValue = undefined;
});
afterAll(async () => {
  await runSeed(process.env.DATABASE_URL!);
  await getPool().end();
}, 60_000);

async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await getPool().query(text, values)).rows as T[];
}
async function count(table: string): Promise<number> {
  const [row] = await query<{ n: number }>(`select count(*)::int n from ${table}`);
  return row.n;
}
// Fingerprint of everything in workday, to show a reset leaves it alone.
async function workdayFingerprint(): Promise<string> {
  const [row] = await query<{ h: string }>(
    `select md5(
       coalesce((select string_agg(w::text, '|' order by w.worker_id) from workday.workers w), '') ||
       coalesce((select string_agg(r::text, '|' order by r.raw_id) from workday.raw_worker_report r), '') ||
       coalesce((select string_agg(i::text, '|' order by i.run_id) from workday.ingest_runs i), '')
     ) h`,
  );
  return row.h;
}

// Makes the app tables differ from the seed: a move (two audit rows, two version bumps) and a
// simulated edit (a third row).
async function makeSeveralChanges(): Promise<void> {
  const [leaderRow] = await query<{ leader_id: number }>(
    "select leader_id from app.leaders where worker_id = $1",
    [DIVISION_LEADER_WORKER],
  );
  const leader = (await findLeader(leaderRow.leader_id))!;
  const [from] = await query<{ seat_id: number; worker_id: string; version: number }>(
    `select s.seat_id, s.worker_id, s.version from app.seats s
     join workday.workers w on w.worker_id = s.worker_id
     join app.squads q on q.squad_id = s.squad_id
     where s.seat_type = 'employee' and w.status = 'active' and w.worker_type = 'employee'
       and q.group_id in (select group_id from app.groups where division_id = $1)
     order by s.seat_id limit 1`,
    [leader.divisionId],
  );
  const [to] = await query<{ version: number }>(
    "select version from app.seats where seat_id = $1",
    [OUT_OF_SCOPE_OPEN_SEAT],
  );
  const moved = await moveWorker(
    {
      workerId: from.worker_id,
      fromSeatId: from.seat_id,
      toSeatId: OUT_OF_SCOPE_OPEN_SEAT,
      effectiveDate: utcToday(),
      fromSeatVersion: from.version,
      toSeatVersion: to.version,
    },
    leader,
  );
  expect(moved.ok).toBe(true);
  const touched = await simulateAnotherLeaderEdit(from.seat_id, leader);
  expect(touched.ok).toBe(true);
}

describe("reset demo data", () => {
  it("returns the app tables to the seed checksum after several changes, leaving workday alone", async () => {
    expect(await checkSeed(process.env.DATABASE_URL!)).toBe(baseline);
    const workdayBefore = await workdayFingerprint();
    const workersBefore = await count("workday.workers");

    await makeSeveralChanges();
    expect(await count("app.seat_changes")).toBeGreaterThanOrEqual(3);
    expect(await checkSeed(process.env.DATABASE_URL!)).not.toBe(baseline);

    const result = await resetDemoData();

    expect(result).toMatchObject({ ok: true });
    expect(await checkSeed(process.env.DATABASE_URL!)).toBe(baseline);
    expect(await count("app.seat_changes")).toBe(0);
    // Workday is untouched.
    expect(await workdayFingerprint()).toBe(workdayBefore);
    expect(await count("workday.workers")).toBe(workersBefore);
    // Ids restart at 1, as after a fresh seed: the next audit row is change 1.
    await makeSeveralChanges();
    const [first] = await query<{ min: number }>(
      "select min(change_id)::int min from app.seat_changes",
    );
    expect(first.min).toBe(1);
  });

  it("still refuses TRUNCATE of seat_changes outside the reset (the trigger is unchanged)", async () => {
    await expect(query("truncate app.seat_changes")).rejects.toThrow(/append-only/);
    await makeSeveralChanges();
    await expect(query("delete from app.seat_changes")).rejects.toThrow(/append-only/);
  });

  it("refuses a second reset within a minute, and allows one after a minute", async () => {
    const t0 = new Date("2026-11-13T12:00:00Z");
    expect(await resetDemoData({ now: t0 })).toMatchObject({ ok: true });

    await makeSeveralChanges();
    const changes = await count("app.seat_changes");
    const tooSoon = await resetDemoData({ now: new Date(t0.getTime() + 59_000) });
    expect(tooSoon).toMatchObject({ ok: false, code: "THROTTLED" });
    // Refused means nothing was reset.
    expect(await count("app.seat_changes")).toBe(changes);

    const later = await resetDemoData({ now: new Date(t0.getTime() + 60_000) });
    expect(later).toMatchObject({ ok: true });
    expect(await checkSeed(process.env.DATABASE_URL!)).toBe(baseline);
  });

  it("lets only one of two simultaneous resets through", async () => {
    const now = new Date("2026-11-13T12:00:00Z");
    const results = await Promise.all([resetDemoData({ now }), resetDemoData({ now })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: "THROTTLED" });
  });
});

describe("resetDemoDataAction: DEMO_MODE gate (D-023)", () => {
  it("returns NOT_FOUND without DEMO_MODE, and writes nothing", async () => {
    vi.stubEnv("DEMO_MODE", "");
    delete process.env.DEMO_MODE;
    await makeSeveralChanges();
    const checksumBefore = await checkSeed(process.env.DATABASE_URL!);
    const changesBefore = await count("app.seat_changes");

    const result = await resetDemoDataAction();

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await checkSeed(process.env.DATABASE_URL!)).toBe(checksumBefore);
    expect(await count("app.seat_changes")).toBe(changesBefore);
    expect(await count("app.demo_reset_state")).toBe(0); // not even the throttle claim
  });

  it("with DEMO_MODE=true resets, then refuses a second reset within a minute (THROTTLED)", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await makeSeveralChanges();

    expect(await resetDemoDataAction()).toMatchObject({ ok: true });
    expect(await checkSeed(process.env.DATABASE_URL!)).toBe(baseline);

    await makeSeveralChanges();
    const changes = await count("app.seat_changes");
    const second = await resetDemoDataAction();
    expect(second).toMatchObject({ ok: false, code: "THROTTLED" });
    expect(await count("app.seat_changes")).toBe(changes);
  });
});
