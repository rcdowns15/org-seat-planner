import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NEXT_REPORT_DATE, SEED_DATE } from "../../scripts/seed/config";
import { BOM, formatCsv, parseCsv } from "../../scripts/seed/csv";
import { dayNumber, fromDayNumber, fromUsDate } from "../../scripts/seed/dates";
import { SQUAD_NOUNS, SQUAD_WORDS } from "../../scripts/seed/names";
import { generateSeedData } from "../../scripts/seed/generate";
import {
  CHANGE_KINDS,
  REPORT_COLUMNS,
  buildReportCsv,
  diffReports,
} from "../../scripts/seed/workday-reports";
import {
  inReportPopulation,
  terminationWindowStart,
  type SeedWorker,
} from "../../scripts/seed/workers";
import {
  documentedChanges,
  documentedColumns,
  documentedFixtures,
  documentedSampleLines,
} from "../support/seed-readme";

const data = generateSeedData();
const report1 = buildReportCsv(data.workers);
const report2 = buildReportCsv(data.nextReportWorkers);
const REPORTS = [
  { date: SEED_DATE, csv: report1 },
  { date: NEXT_REPORT_DATE, csv: report2 },
];

// Parsed report rows as records keyed by column name (cells trimmed).
function records(csv: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(csv);
  return body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i].trim()])));
}

const daysAfter = (usDate: string, isoDate: string) =>
  dayNumber(fromUsDate(usDate)) - dayNumber(isoDate);

describe("seed generator (pure, no database)", () => {
  it("is deterministic: two runs build identical reports", () => {
    const again = generateSeedData();
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(hash(buildReportCsv(again.workers))).toBe(hash(report1));
    expect(hash(buildReportCsv(again.nextReportWorkers))).toBe(hash(report2));
    expect(again.seats).toEqual(data.seats);
  });

  it("round-trips quoted CSV fields, with or without the BOM and CRLF", () => {
    const rows = [["a,b", 'say "hi"', "O'Halloran, Seán"]];
    const csv = formatCsv(["x", "y", "z"], rows);
    expect(parseCsv(csv)).toEqual([["x", "y", "z"], ...rows]);
    expect(parseCsv(csv.slice(1).replaceAll("\r\n", "\n"))).toEqual([["x", "y", "z"], ...rows]);
  });
});

describe("report realism (D-031)", () => {
  it("starts each file with a UTF-8 BOM and uses CRLF line endings only", () => {
    for (const { csv } of REPORTS) {
      expect(csv.startsWith(BOM)).toBe(true);
      expect(Buffer.from(csv, "utf8").subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      expect(csv.endsWith("\r\n")).toBe(true);
      expect(csv.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/); // no bare LF or CR
    }
  });

  it("quotes every field that contains a comma", () => {
    for (const { csv } of REPORTS) {
      for (const line of csv.slice(1).split("\r\n").filter(Boolean)) {
        // Splitting on commas outside quotes must give exactly one cell per column.
        const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.filter((c) => c !== "");
        expect(cells.length, line).toBe(REPORT_COLUMNS.length);
      }
    }
  });

  it("applies the population rule: terminated rows are within 30 days of the report date", () => {
    for (const { date, csv } of REPORTS) {
      const rows = records(csv);
      const terminated = rows.filter((r) => r.Worker_Status === "Terminated");
      expect(terminated.length).toBeGreaterThan(0);
      for (const r of terminated) {
        const age = -daysAfter(r.Termination_Date, date);
        expect(age, r.Worker_ID).toBeGreaterThanOrEqual(0);
        expect(age, r.Worker_ID).toBeLessThan(30);
      }
    }
  });

  it.each([
    ["2026-11-15", "2026-10-17"],
    ["2026-11-01", "2026-10-03"],
  ])("opens the termination window for the %s report on %s", (reportDate, windowStart) => {
    expect(terminationWindowStart(reportDate)).toBe(windowStart);
    const terminatedOn = (date: string) =>
      ({ status: "terminated", terminationDate: date }) as SeedWorker;
    const dayBefore = fromDayNumber(dayNumber(windowStart) - 1);
    expect(inReportPopulation(terminatedOn(dayBefore), reportDate)).toBe(false);
    expect(inReportPopulation(terminatedOn(windowStart), reportDate)).toBe(true);
    expect(inReportPopulation(terminatedOn(reportDate), reportDate)).toBe(true);
  });

  it("drops documented aged-out workers legitimately and exactly one documented missing worker", () => {
    const before = new Map(records(report1).map((r) => [r.Worker_ID, r]));
    const after = new Set(records(report2).map((r) => r.Worker_ID));
    const documented = documentedChanges();
    const agedOut = documented.filter((c) => c.change === "aged_out");
    const missing = documented.filter((c) => c.change === "missing");

    expect(agedOut.length).toBeGreaterThanOrEqual(1);
    for (const c of agedOut) {
      const old = before.get(c.workerId)!;
      expect(old.Worker_Status).toBe("Terminated");
      expect(fromUsDate(old.Termination_Date) < terminationWindowStart(NEXT_REPORT_DATE)).toBe(
        true,
      );
      expect(after.has(c.workerId)).toBe(false);
    }

    expect(missing).toHaveLength(1);
    const old = before.get(missing[0].workerId)!;
    expect(old.Worker_Status).toBe("Active");
    expect(old.Termination_Date).toBe("");
    expect(after.has(missing[0].workerId)).toBe(false);

    // Nobody else disappears.
    const dropped = [...before.keys()].filter((id) => !after.has(id)).sort();
    expect(dropped).toEqual([...agedOut, ...missing].map((c) => c.workerId).sort());
  });

  it("has 2-3 future-dated hires in 11-15, each in a group with an offer_accepted seat", () => {
    const seeded = new Set(data.workers.map((w) => w.workerId));
    const future = records(report2).filter((r) => daysAfter(r.Hire_Date, NEXT_REPORT_DATE) > 0);
    expect(future.length).toBeGreaterThanOrEqual(2);
    expect(future.length).toBeLessThanOrEqual(3);

    const offersByCostCenter = new Map<string, number>();
    for (const seat of data.seats.filter((s) => s.status === "offer_accepted")) {
      const cc = data.org.groups[data.org.squads[seat.squadIndex].groupIndex].costCenter;
      offersByCostCenter.set(cc, (offersByCostCenter.get(cc) ?? 0) + 1);
    }
    const futureByCostCenter = new Map<string, number>();
    const seated = new Set(data.seats.map((s) => s.workerId));
    for (const r of future) {
      const days = daysAfter(r.Hire_Date, NEXT_REPORT_DATE);
      expect(days, r.Worker_ID).toBeGreaterThanOrEqual(1);
      expect(days, r.Worker_ID).toBeLessThanOrEqual(60);
      expect(r.Worker_Status).toBe("Active");
      expect(seeded.has(r.Worker_ID), r.Worker_ID).toBe(false); // only in the 11-15 CSV
      expect(seated.has(r.Worker_ID), r.Worker_ID).toBe(false); // holds no seat
      expect(offersByCostCenter.get(r.Cost_Center) ?? 0, r.Worker_ID).toBeGreaterThan(0);
      futureByCostCenter.set(r.Cost_Center, (futureByCostCenter.get(r.Cost_Center) ?? 0) + 1);
    }
    // At least one hiring group has more offer_accepted seats than future hires (the gap).
    const gaps = [...futureByCostCenter].filter(([cc, n]) => offersByCostCenter.get(cc)! > n);
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    // Every documented future hire is one of these rows, and vice versa.
    expect(
      documentedChanges()
        .filter((c) => c.change === "future_hire")
        .map((c) => c.workerId)
        .sort(),
    ).toEqual(future.map((r) => r.Worker_ID).sort());
  });

  it("shows supervisory orgs as `<org> (<manager>)`, following the manager tree", () => {
    for (const { csv } of REPORTS) {
      const rows = records(csv);
      const byId = new Map(rows.map((r) => [r.Worker_ID, r]));
      const orgByManager = new Map<string, string>();
      for (const r of rows) {
        expect(r.Supervisory_Organization, r.Worker_ID).toMatch(/^.+ \(.+\)$/);
        const managerRow = byId.get(r.Manager_ID || r.Worker_ID)!;
        const [last, first] = managerRow.Worker_Name.split(",").map((s) => s.trim());
        expect(r.Supervisory_Organization.endsWith(` (${first} ${last})`), r.Worker_ID).toBe(true);
        // Everyone with the same manager is in the same org.
        const key = r.Manager_ID || "(top)";
        expect(orgByManager.get(key) ?? r.Supervisory_Organization).toBe(
          r.Supervisory_Organization,
        );
        orgByManager.set(key, r.Supervisory_Organization);
      }
      // Not the squads: no supervisory org is named after a squad.
      const squadNames = new Set(data.org.squads.map((s) => s.name));
      for (const org of orgByManager.values()) {
        expect(squadNames.has(org.replace(/ \(.+\)$/, ""))).toBe(false);
      }
    }
  });

  it("uses six-digit employee ids and C-plus-five-digit contingent ids", () => {
    for (const { csv } of REPORTS) {
      const rows = records(csv);
      expect(rows.some((r) => r.Worker_Type === "Contingent Worker")).toBe(true);
      for (const r of rows) {
        const pattern = r.Worker_Type === "Employee" ? /^\d{6}$/ : /^C-\d{5}$/;
        expect(r.Worker_ID).toMatch(pattern);
        if (r.Manager_ID) expect(r.Manager_ID).toMatch(/^\d{6}$/);
      }
    }
    // The same scheme is used for app.seats and app.leaders.
    for (const seat of data.seats) {
      if (seat.workerId) {
        expect(seat.workerId).toMatch(seat.seatType === "employee" ? /^\d{6}$/ : /^C-\d{5}$/);
      }
    }
    for (const leader of data.leaders) expect(leader.workerId).toMatch(/^\d{6}$/);
  });

  it("sets Contract_End_Date exactly for contingent rows, as MM/DD/YYYY after the hire date", () => {
    for (const { csv } of REPORTS) {
      for (const r of records(csv)) {
        if (r.Worker_Type === "Contingent Worker") {
          expect(r.Contract_End_Date, r.Worker_ID).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
          expect(fromUsDate(r.Contract_End_Date) > fromUsDate(r.Hire_Date)).toBe(true);
        } else {
          expect(r.Contract_End_Date, r.Worker_ID).toBe("");
        }
      }
    }
  });

  it("has at least 3 names with an apostrophe, accent or hyphen that round-trip unchanged", () => {
    // Parsed here with the generator's own parseCsv; BR-03's ingest tests will re-parse the files
    // with an independent parser.
    const special = /['\-À-ſ]/;
    const expected = new Map(
      [...data.workers, ...data.nextReportWorkers].map((w) => [
        w.workerId,
        `${w.lastName}, ${w.firstName}`,
      ]),
    );
    for (const { csv } of REPORTS) {
      const names = records(csv).filter((r) => special.test(r.Worker_Name));
      expect(names.length).toBeGreaterThanOrEqual(3);
      expect(names.filter((r) => /[À-ſ]/.test(r.Worker_Name)).length).toBeGreaterThanOrEqual(3);
      for (const r of names) expect(r.Worker_Name).toBe(expected.get(r.Worker_ID));
    }
  });

  it("uses no squad name that is, or contains, a real product name", () => {
    const blocked = [
      "Quartz Scheduler",
      "Onyx",
      "Falcon",
      "Juniper",
      "Summit",
      "Beacon",
      "Kafka",
      "Airflow",
      "Spark",
    ];
    const hit = (name: string) => blocked.find((b) => new RegExp(`\\b${b}\\b`, "i").test(name));
    // Every possible name the vocabulary can produce, not only the 180 used.
    const vocabulary = SQUAD_WORDS.flatMap((w) => SQUAD_NOUNS.map((n) => `${w} ${n}`));
    expect(vocabulary.filter((n) => hit(n))).toEqual([]);
    expect(data.org.squads.filter((s) => hit(s.name))).toEqual([]);
    // The check itself catches what it should.
    expect(hit("Quartz Scheduler")).toBe("Quartz Scheduler");
    expect(hit("falcon Vault")).toBe("Falcon");
  });
});

describe("scripts/seed/README.md matches the code", () => {
  it("documents exactly the report header, in order", () => {
    const header = parseCsv(report1)[0];
    expect(header).toEqual([...REPORT_COLUMNS]);
    expect(documentedColumns().map((c) => c.column)).toEqual(header);
  });

  it("has sample rows taken from the generated 11-01 report", () => {
    const [headerLine, ...sampleLines] = documentedSampleLines();
    const lines = report1.slice(BOM.length).split("\r\n");
    expect(headerLine).toBe(lines[0]);
    expect(sampleLines.length).toBeGreaterThanOrEqual(1);
    for (const sample of sampleLines) {
      expect(lines).toContain(sample);
      expect(parseCsv(sample)[0]).toHaveLength(REPORT_COLUMNS.length);
    }
  });

  it("documents every difference between the 11-01 and 11-15 reports", () => {
    const actual = diffReports(parseCsv(report1), parseCsv(report2), NEXT_REPORT_DATE);
    expect(documentedChanges()).toEqual(actual);
    expect(new Set(actual.map((c) => c.change))).toEqual(new Set(CHANGE_KINDS));
  });

  it("fails the diff on an undocumented kind of change", () => {
    const tampered = parseCsv(report2).map((r) => [...r]);
    tampered[1][REPORT_COLUMNS.indexOf("Location")] = "Elsewhere";
    expect(() => diffReports(parseCsv(report1), tampered, NEXT_REPORT_DATE)).toThrow(
      /Unexpected change/,
    );
  });

  it("fails the diff when a manager change doesn't move the supervisory org", () => {
    const rows = parseCsv(report2);
    const mgr = REPORT_COLUMNS.indexOf("Manager_ID");
    const org = REPORT_COLUMNS.indexOf("Supervisory_Organization");
    const victim = rows.findIndex((r, i) => i > 1 && r[mgr] && r[mgr] !== rows[1][0]);
    const tampered = rows.map((r) => [...r]);
    // Point the worker at the top manager, and fake an org name that doesn't follow.
    tampered[victim][mgr] = rows[1][0];
    tampered[victim][org] = `Somewhere (Nobody ${victim})`;
    expect(() => diffReports(parseCsv(report1), tampered, NEXT_REPORT_DATE)).toThrow(
      /doesn't follow manager/,
    );
  });

  it("documents each named demo fixture with a key and value", () => {
    expect(Object.keys(documentedFixtures()).sort()).toEqual([
      "demo-division-leader",
      "demo-group-leader",
      "out-of-scope-open-seat",
      "terminated-seated-worker",
      "worker-on-leave",
    ]);
  });

  it("keeps the terminated-seated-worker fixture inside the 11-15 report window", () => {
    const id = documentedFixtures()["terminated-seated-worker"].value;
    const row = records(report2).find((r) => r.Worker_ID === id)!;
    expect(row.Worker_Status).toBe("Terminated");
    expect(fromUsDate(row.Termination_Date) >= terminationWindowStart(NEXT_REPORT_DATE)).toBe(true);
  });

  it("keeps every manager in the 11-15 report at 3-15 direct reports", () => {
    const counts = new Map<string, number>();
    for (const r of records(report2)) {
      if (r.Manager_ID) counts.set(r.Manager_ID, (counts.get(r.Manager_ID) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThan(100);
    for (const [manager, n] of counts) {
      expect(n, manager).toBeGreaterThanOrEqual(3);
      expect(n, manager).toBeLessThanOrEqual(15);
    }
  });

  it("gives every new hire in 11-15 a new Position_ID", () => {
    const before = new Set(records(report1).map((r) => r.Position_ID));
    const hires = documentedChanges().filter(
      (c) => c.change === "hire" || c.change === "future_hire",
    );
    expect(hires.length).toBeGreaterThanOrEqual(3);
    for (const hire of hires) {
      const position = /Position_ID (P-\d{6})/.exec(hire.detail)![1];
      expect(before.has(position)).toBe(false);
    }
  });

  it("keeps hire dates on or before the report date, except documented future hires", () => {
    const future = new Set(
      documentedChanges()
        .filter((c) => c.change === "future_hire")
        .map((c) => c.workerId),
    );
    for (const { date, csv } of REPORTS) {
      for (const r of records(csv)) {
        const days = daysAfter(r.Hire_Date, date);
        if (future.has(r.Worker_ID) && date === NEXT_REPORT_DATE) {
          expect(days).toBeGreaterThanOrEqual(1);
          expect(days).toBeLessThanOrEqual(60);
        } else {
          expect(days, r.Worker_ID).toBeLessThanOrEqual(0);
        }
      }
    }
  });
});
