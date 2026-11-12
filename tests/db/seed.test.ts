import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkSeed, runSeed, type SeedResult } from "../../scripts/seed/run-seed";
import { BOM, parseCsv } from "../../scripts/seed/csv";
import { fromUsDate } from "../../scripts/seed/dates";
import { REPORT_COLUMNS } from "../../scripts/seed/workday-reports";
import { getPool } from "@/server/db";
import { documentedChanges, documentedFixtures } from "../support/seed-readme";
import { localChildEnv } from "./local-db";

const REPORT_1 = path.join("data", "workday", "worker_report_2026-11-01.csv");
const REPORT_2 = path.join("data", "workday", "worker_report_2026-11-15.csv");
const url = () => process.env.DATABASE_URL!;
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function rows<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await getPool().query(text, values)).rows as T[];
}
async function one<T>(text: string, values: unknown[] = []): Promise<T> {
  return (await rows<T>(text, values))[0];
}

type Worker = {
  worker_id: string;
  worker_type: string;
  status: string;
  hire_date: string;
  termination_date: string | null;
  manager_worker_id: string | null;
  position_id: string;
  cost_center: string;
  location: string;
};

let first: SeedResult;
let second: SeedResult;

// The seed truncates and reloads the dev database, so this file runs it once up front (the db
// project runs files one at a time, so it can't collide with the constraint tests).
beforeAll(async () => {
  first = await runSeed(url());
  second = await runSeed(url());
}, 60_000);

describe("determinism", () => {
  it("prints the same checksum when seeded twice, and db:seed:check agrees", async () => {
    expect(first.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(second.checksum).toBe(first.checksum);
    expect(await checkSeed(url())).toBe(first.checksum);
  });

  it("prints the same checksum from two runs of the real `db:seed` command", () => {
    const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
    const run = () =>
      execFileSync(process.execPath, [tsx, "scripts/seed/index.ts"], {
        encoding: "utf8",
        env: localChildEnv(url()),
      });
    const line = (out: string) => /^seed checksum: ([0-9a-f]{64})$/m.exec(out)![1];
    const a = line(run());
    expect(a).toBe(first.checksum);
    expect(line(run())).toBe(a);
    const check = execFileSync(process.execPath, [tsx, "scripts/seed/index.ts", "--check"], {
      encoding: "utf8",
      env: localChildEnv(url()),
    });
    expect(line(check)).toBe(a);
  }, 60_000);

  it("writes byte-identical report files on every run", () => {
    expect(second.reports).toEqual(first.reports);
    expect(first.reports.map((r) => path.basename(r.file))).toEqual([
      "worker_report_2026-11-01.csv",
      "worker_report_2026-11-15.csv",
    ]);
    expect(sha256(REPORT_1)).toBe(first.reports[0].sha256);
    expect(sha256(REPORT_2)).toBe(first.reports[1].sha256);
  });

  it("keeps data/workday/ out of git", () => {
    expect(() => execFileSync("git", ["check-ignore", "-q", REPORT_1])).not.toThrow();
    expect(() => execFileSync("git", ["check-ignore", "-q", REPORT_2])).not.toThrow();
  });

  it("can reseed after the audit log has rows (TRUNCATE guard path)", async () => {
    const seat = await one<{ seat_id: number }>(
      "select seat_id from app.seats where status = 'open' order by seat_id limit 1",
    );
    const leader = await one<{ leader_id: number }>("select leader_id from app.leaders limit 1");
    await getPool().query(
      `insert into app.seat_changes
         (change_type, seat_id, from_status, to_status, actor_leader_id, effective_date)
       values ('demo_touch', $1, 'open', 'open', $2, '2026-11-02')`,
      [seat.seat_id, leader.leader_id],
    );
    expect((await one<{ n: string }>("select count(*) n from app.seat_changes")).n).toBe("1");
    const again = await runSeed(url());
    expect(again.checksum).toBe(first.checksum);
    expect((await one<{ n: string }>("select count(*) n from app.seat_changes")).n).toBe("0");
  }, 60_000);
});

describe("invariants", () => {
  it("has the org shape: 4 divisions, 12 groups, about 180 squads, a leader for each", async () => {
    const c = await one<Record<string, string>>(
      `select (select count(*) from app.divisions) d, (select count(*) from app.groups) g,
              (select count(*) from app.squads) s`,
    );
    expect([c.d, c.g, c.s]).toEqual(["4", "12", "180"]);
    const uncovered = await rows(
      `select 'division' kind, division_id from app.divisions
         where division_id not in (select division_id from app.leaders where division_id is not null)
       union all
       select 'group', group_id from app.groups
         where group_id not in (select group_id from app.leaders where group_id is not null)`,
    );
    expect(uncovered).toEqual([]);
  });

  it("seats 1,900-2,100 workers, 8-12% contingent, without double-seating", async () => {
    const w = await one<{ total: string; contingent: string }>(
      `select count(*) total, count(*) filter (where worker_type = 'contingent') contingent
         from workday.workers`,
    );
    const total = Number(w.total);
    expect(total).toBeGreaterThanOrEqual(1900);
    expect(total).toBeLessThanOrEqual(2100);
    const share = Number(w.contingent) / total;
    expect(share).toBeGreaterThanOrEqual(0.08);
    expect(share).toBeLessThanOrEqual(0.12);
    const dupes = await rows(
      `select worker_id from app.seats where worker_id is not null
         group by worker_id having count(*) > 1`,
    );
    expect(dupes).toEqual([]);
  });

  it("has 170-230 open + backfill seats and some offer_accepted seats", async () => {
    const s = await one<{ open_backfill: string; offers: string }>(
      `select count(*) filter (where status in ('open', 'backfill')) open_backfill,
              count(*) filter (where status = 'offer_accepted') offers
         from app.seats`,
    );
    expect(Number(s.open_backfill)).toBeGreaterThanOrEqual(170);
    expect(Number(s.open_backfill)).toBeLessThanOrEqual(230);
    expect(Number(s.offers)).toBeGreaterThan(0);
  });

  it("has a Workday worker for every leader", async () => {
    const missing = await rows(
      `select l.leader_id from app.leaders l
        where not exists (select 1 from workday.workers w where w.worker_id = l.worker_id)`,
    );
    expect(missing).toEqual([]);
  });

  it("matches every seat's type to its worker's type", async () => {
    const mismatched = await rows(
      `select s.seat_id from app.seats s join workday.workers w using (worker_id)
        where s.seat_type <> w.worker_type`,
    );
    expect(mismatched).toEqual([]);
    const orphans = await rows(
      `select seat_id from app.seats s
        where worker_id is not null
          and not exists (select 1 from workday.workers w where w.worker_id = s.worker_id)`,
    );
    expect(orphans).toEqual([]);
  });

  it("gives every squad a plan row for the previous 2, current and next 2 quarters", async () => {
    const quarters = ["2026-04-01", "2026-07-01", "2026-10-01", "2027-01-01", "2027-04-01"];
    const missing = await rows(
      `select s.squad_id, q.quarter_start
         from app.squads s cross join unnest($1::date[]) as q(quarter_start)
        where not exists (select 1 from app.headcount_plan p
                           where p.squad_id = s.squad_id and p.quarter_start = q.quarter_start)`,
      [quarters],
    );
    expect(missing).toEqual([]);
  });
});

describe("named demo fixtures (keys documented in scripts/seed/README.md)", () => {
  const fixtures = documentedFixtures();

  it("has the demo division leader", async () => {
    const f = fixtures["demo-division-leader"];
    expect(f.key).toBe("app.leaders.worker_id");
    const leader = await one<{ scope_type: string }>(
      "select scope_type from app.leaders where worker_id = $1",
      [f.value],
    );
    expect(leader.scope_type).toBe("division");
  });

  it("has the demo group leader, and an open seat outside their group", async () => {
    const f = fixtures["demo-group-leader"];
    expect(f.key).toBe("app.leaders.worker_id");
    const leader = await one<{ scope_type: string; group_id: number; division_id: number }>(
      `select l.scope_type, l.group_id, g.division_id
         from app.leaders l join app.groups g using (group_id) where l.worker_id = $1`,
      [f.value],
    );
    expect(leader.scope_type).toBe("group");

    const seatFixture = fixtures["out-of-scope-open-seat"];
    expect(seatFixture.key).toBe("app.seats.seat_id");
    const seat = await one<{
      status: string;
      seat_type: string;
      group_id: number;
      division_id: number;
    }>(
      `select s.status, s.seat_type, q.group_id, g.division_id
         from app.seats s join app.squads q using (squad_id) join app.groups g using (group_id)
        where s.seat_id = $1`,
      [Number(seatFixture.value)],
    );
    expect(seat.status).toBe("open");
    expect(seat.seat_type).toBe("employee");
    expect(seat.group_id).not.toBe(leader.group_id); // outside the group leader's scope
    expect(seat.division_id).toBe(leader.division_id); // inside the division leader's
    const divisionLeader = await one<{ division_id: number }>(
      "select division_id from app.leaders where worker_id = $1",
      [fixtures["demo-division-leader"].value],
    );
    expect(divisionLeader.division_id).toBe(seat.division_id);
  });

  it("has a worker on leave who keeps their seat", async () => {
    const f = fixtures["worker-on-leave"];
    expect(f.key).toBe("workday.workers.worker_id");
    const w = await one<{ status: string; seat_id: number | null }>(
      `select w.status, s.seat_id from workday.workers w
         left join app.seats s on s.worker_id = w.worker_id where w.worker_id = $1`,
      [f.value],
    );
    expect(w.status).toBe("leave");
    expect(w.seat_id).not.toBeNull();
  });

  it("has a terminated worker who still holds a seat", async () => {
    const f = fixtures["terminated-seated-worker"];
    expect(f.key).toBe("workday.workers.worker_id");
    const w = await one<{
      status: string;
      termination_date: string | null;
      seat_id: number | null;
    }>(
      `select w.status, w.termination_date::text, s.seat_id from workday.workers w
         left join app.seats s on s.worker_id = w.worker_id where w.worker_id = $1`,
      [f.value],
    );
    expect(w.status).toBe("terminated");
    expect(w.termination_date).not.toBeNull();
    expect(w.seat_id).not.toBeNull();
  });
});

describe("Workday report files", () => {
  const read = (file: string) => parseCsv(readFileSync(file, "utf8"));

  it("writes each file with a UTF-8 BOM and CRLF line endings", () => {
    for (const file of [REPORT_1, REPORT_2]) {
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      const text = bytes.toString("utf8");
      expect(text.startsWith(BOM)).toBe(true);
      expect(text.endsWith("\r\n")).toBe(true);
      expect(text.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
    }
  });

  it("matches the seeded state: the 11-01 report equals workday.workers", async () => {
    const [header, ...body] = read(REPORT_1);
    expect(header).toEqual([...REPORT_COLUMNS]);
    // Contract_End_Date is CSV only (D-031): drop it before comparing with the database.
    const contractCol = header.indexOf("Contract_End_Date");
    const db = await rows<Record<string, string | null>>(
      `select worker_id, last_name, first_name, email, worker_type, status,
              hire_date::text, termination_date::text, manager_worker_id, job_title,
              supervisory_org, position_id, cost_center, location
         from workday.workers order by worker_id`,
    );
    expect(body).toHaveLength(db.length);
    const typeText: Record<string, string> = {
      employee: "Employee",
      contingent: "Contingent Worker",
    };
    const statusText: Record<string, string> = {
      active: "Active",
      leave: "On Leave",
      terminated: "Terminated",
    };
    const fromFile = body
      .map((cells) => cells.map((c) => c.trim()).filter((_, i) => i !== contractCol))
      .sort((a, b) => a[0].localeCompare(b[0]));
    const fromDb = db.map((w) => [
      w.worker_id,
      `${w.last_name}, ${w.first_name}`,
      w.email,
      typeText[w.worker_type!],
      statusText[w.status!],
      w.hire_date,
      w.termination_date ?? "",
      w.manager_worker_id ?? "",
      w.job_title,
      w.supervisory_org,
      w.position_id,
      w.cost_center,
      w.location,
    ]);
    const normalized = fromFile.map((c) => [
      ...c.slice(0, 5),
      fromUsDate(c[5]),
      c[6] ? fromUsDate(c[6]) : "",
      ...c.slice(7),
    ]);
    expect(normalized).toEqual(fromDb);
  });

  it("uses Workday-style messy formats", () => {
    const [header, ...body] = read(REPORT_1);
    const col = (name: string) => header.indexOf(name);
    for (const cells of body) {
      expect(cells[col("Worker_Name")]).toMatch(/^[^,]+, [^,]+ ?$/);
      expect(cells[col("Hire_Date")]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(["Active", "On Leave", "Terminated"]).toContain(cells[col("Worker_Status")]);
      expect(["Employee", "Contingent Worker"]).toContain(cells[col("Worker_Type")]);
      expect(cells[col("Position_ID")]).toMatch(/^P-\d{6}$/);
      expect(cells[col("Cost_Center")]).toMatch(/^CC-\d{4} \S/);
      expect(["Charlotte", "Dallas", "Denver", "Chicago", "New York", "Remote"]).toContain(
        cells[col("Location")].trim(),
      );
    }
    // Stray whitespace is present on purpose.
    expect(body.some((cells) => cells.some((c) => c !== c.trim()))).toBe(true);
  });

  it("has an 11-15 report that drops only the documented aged-out and missing workers", () => {
    const a = read(REPORT_1);
    const b = read(REPORT_2);
    const ids = new Set(b.slice(1).map((r) => r[0]));
    const dropped = a
      .slice(1)
      .map((r) => r[0])
      .filter((id) => !ids.has(id))
      .sort();
    const documented = documentedChanges()
      .filter((c) => c.change === "aged_out" || c.change === "missing")
      .map((c) => c.workerId)
      .sort();
    expect(dropped).toEqual(documented);
    expect(dropped.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the documented missing worker seated and active in the database", async () => {
    const missing = documentedChanges().filter((c) => c.change === "missing");
    expect(missing).toHaveLength(1);
    const w = await one<{ status: string; termination_date: string | null; seat_id: number }>(
      `select w.status, w.termination_date::text, s.seat_id from workday.workers w
         join app.seats s on s.worker_id = w.worker_id where w.worker_id = $1`,
      [missing[0].workerId],
    );
    expect(w.status).toBe("active");
    expect(w.termination_date).toBeNull();
  });

  it("puts each future-dated hire in a group with an offer_accepted seat, holding no seat", async () => {
    const [header, ...body] = read(REPORT_2);
    const col = (name: string) => header.indexOf(name);
    const future = documentedChanges().filter((c) => c.change === "future_hire");
    expect(future.length).toBeGreaterThanOrEqual(2);
    expect(future.length).toBeLessThanOrEqual(3);
    for (const hire of future) {
      const row = body.find((r) => r[col("Worker_ID")] === hire.workerId)!;
      const costCenter = row[col("Cost_Center")].trim();
      const found = await one<{ in_workday: boolean; seated: boolean; offers: string }>(
        `select exists (select 1 from workday.workers where worker_id = $1) in_workday,
                exists (select 1 from app.seats where worker_id = $1) seated,
                (select count(*) from app.seats s join app.squads q using (squad_id)
                   join app.groups g using (group_id)
                  where s.status = 'offer_accepted'
                    and regexp_replace($2, '^CC-[0-9]{4} ', '') = g.name) offers`,
        [hire.workerId, costCenter],
      );
      expect(found.in_workday, hire.workerId).toBe(false); // the seeded state is 11-01
      expect(found.seated, hire.workerId).toBe(false);
      expect(Number(found.offers), hire.workerId).toBeGreaterThan(0);
    }
  });
});

describe("plausibility", () => {
  let workers: Worker[];
  beforeAll(async () => {
    workers = await rows<Worker>(
      `select worker_id, worker_type, status, hire_date::text, termination_date::text,
              manager_worker_id, position_id, cost_center, location
         from workday.workers`,
    );
  });

  it("gives every manager 3-15 direct reports", () => {
    const counts = new Map<string, number>();
    for (const w of workers) {
      if (w.manager_worker_id) {
        counts.set(w.manager_worker_id, (counts.get(w.manager_worker_id) ?? 0) + 1);
      }
    }
    expect(counts.size).toBeGreaterThan(100);
    for (const [manager, n] of counts) {
      expect(n, manager).toBeGreaterThanOrEqual(3);
      expect(n, manager).toBeLessThanOrEqual(15);
    }
  });

  it("reaches the top from every worker with no cycle", () => {
    const byId = new Map(workers.map((w) => [w.worker_id, w]));
    expect(workers.filter((w) => w.manager_worker_id === null)).toHaveLength(1);
    for (const w of workers) {
      const seen = new Set<string>();
      let current: Worker | undefined = w;
      while (current?.manager_worker_id) {
        expect(seen.has(current.worker_id), `cycle at ${w.worker_id}`).toBe(false);
        seen.add(current.worker_id);
        current = byId.get(current.manager_worker_id);
        expect(current, `missing manager above ${w.worker_id}`).toBeDefined();
      }
    }
  });

  it("has sensible hire and termination dates", () => {
    // Future-dated hires are only in the 11-15 CSV (see README), so every seeded worker's hire
    // date is on or before the seeded report date.
    for (const w of workers) {
      expect(w.hire_date <= "2026-11-01", `hire ${w.worker_id}`).toBe(true);
      if (w.termination_date) expect(w.termination_date >= w.hire_date).toBe(true);
      expect(w.termination_date !== null, `termination ${w.worker_id}`).toBe(
        w.status === "terminated",
      );
    }
  });

  it("uses the D-031 worker id schemes in workday.workers, app.seats and app.leaders", async () => {
    for (const w of workers) {
      expect(w.worker_id).toMatch(w.worker_type === "employee" ? /^\d{6}$/ : /^C-\d{5}$/);
    }
    const badSeats = await rows(
      `select seat_id from app.seats
        where worker_id is not null
          and not (seat_type = 'employee' and worker_id ~ '^[0-9]{6}$')
          and not (seat_type = 'contingent' and worker_id ~ '^C-[0-9]{5}$')`,
    );
    expect(badSeats).toEqual([]);
    const badLeaders = await rows(
      "select leader_id from app.leaders where worker_id !~ '^[0-9]{6}$'",
    );
    expect(badLeaders).toEqual([]);
  });

  it("stores supervisory orgs as `<org> (<manager>)`, following the manager", async () => {
    const bad = await rows<{ worker_id: string }>(
      `with orgs as (
         select w.worker_id, w.supervisory_org,
                ' (' || m.first_name || ' ' || m.last_name || ')' manager_suffix
           from workday.workers w
           join workday.workers m on m.worker_id = coalesce(w.manager_worker_id, w.worker_id))
       select worker_id from orgs
        where supervisory_org !~ '^.+ [(].+[)]$'
           or right(supervisory_org, length(manager_suffix)) <> manager_suffix`,
    );
    expect(bad).toEqual([]);
    const all = await one<{ n: string }>("select count(*) n from workday.workers");
    expect(Number(all.n)).toBeGreaterThan(1900);
  });

  it("populates position, cost center and location, with unique positions among current workers", () => {
    for (const w of workers) {
      expect(w.position_id.trim()).not.toBe("");
      expect(w.cost_center.trim()).not.toBe("");
      expect(w.location.trim()).not.toBe("");
    }
    const current = workers.filter((w) => w.status !== "terminated").map((w) => w.position_id);
    expect(new Set(current).size).toBe(current.length);
  });

  it("gives seated workers their seat's group cost center, one per group", async () => {
    const seated = await rows<{ group_id: number; group_name: string; cost_centers: string[] }>(
      `select g.group_id, g.name group_name, array_agg(distinct w.cost_center) cost_centers
         from app.seats s join app.squads q using (squad_id) join app.groups g using (group_id)
         join workday.workers w on w.worker_id = s.worker_id
        group by g.group_id, g.name order by g.group_id`,
    );
    expect(seated).toHaveLength(12);
    for (const g of seated) {
      expect(g.cost_centers, g.group_name).toHaveLength(1);
      expect(g.cost_centers[0]).toMatch(/^CC-\d{4} /);
      expect(g.cost_centers[0].endsWith(` ${g.group_name}`)).toBe(true);
    }
    expect(new Set(seated.map((g) => g.cost_centers[0])).size).toBe(12);
  });
});
