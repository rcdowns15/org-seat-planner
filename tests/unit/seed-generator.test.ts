import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatCsv, parseCsv } from "../../scripts/seed/csv";
import { generateSeedData } from "../../scripts/seed/generate";
import { REPORT_COLUMNS, buildReportCsv, diffReports } from "../../scripts/seed/workday-reports";
import {
  documentedChanges,
  documentedColumns,
  documentedFixtures,
  documentedSampleLines,
} from "../support/seed-readme";

const data = generateSeedData();
const report1 = buildReportCsv(data.workers);
const report2 = buildReportCsv(data.nextReportWorkers);

describe("seed generator (pure, no database)", () => {
  it("is deterministic: two runs build identical reports", () => {
    const again = generateSeedData();
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(hash(buildReportCsv(again.workers))).toBe(hash(report1));
    expect(hash(buildReportCsv(again.nextReportWorkers))).toBe(hash(report2));
    expect(again.seats).toEqual(data.seats);
  });

  it("writes reports with LF line endings and no carriage returns", () => {
    expect(report1).not.toContain("\r");
    expect(report1.endsWith("\n")).toBe(true);
  });

  it("round-trips quoted CSV fields", () => {
    const rows = [["a,b", 'say "hi"', "plain"]];
    expect(parseCsv(formatCsv(["x", "y", "z"], rows))).toEqual([["x", "y", "z"], ...rows]);
  });
});

describe("scripts/seed/README.md matches the code", () => {
  it("documents exactly the report header, in order", () => {
    const header = parseCsv(report1)[0];
    expect(header).toEqual([...REPORT_COLUMNS]);
    expect(documentedColumns().map((c) => c.column)).toEqual(header);
  });

  it("has a sample row taken from the generated 11-01 report", () => {
    const [headerLine, sampleLine] = documentedSampleLines();
    const lines = report1.split("\n");
    expect(headerLine).toBe(lines[0]);
    expect(lines).toContain(sampleLine);
    expect(parseCsv(sampleLine)[0]).toHaveLength(REPORT_COLUMNS.length);
  });

  it("documents every difference between the 11-01 and 11-15 reports", () => {
    const actual = diffReports(parseCsv(report1), parseCsv(report2));
    expect(documentedChanges()).toEqual(actual);
    expect(new Set(actual.map((c) => c.change))).toEqual(
      new Set(["hire", "termination", "manager_change", "leave"]),
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

  it("keeps every manager in the 11-15 report at 3-15 direct reports", () => {
    const [header, ...body] = parseCsv(report2);
    const managerCol = header.indexOf("Manager_ID");
    const counts = new Map<string, number>();
    for (const cells of body) {
      const manager = cells[managerCol].trim();
      if (manager) counts.set(manager, (counts.get(manager) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThan(100);
    for (const [manager, n] of counts) {
      expect(n, manager).toBeGreaterThanOrEqual(3);
      expect(n, manager).toBeLessThanOrEqual(15);
    }
  });

  it("gives every new hire in 11-15 a new Position_ID", () => {
    const before = new Set(
      parseCsv(report1)
        .slice(1)
        .map((r) => r[10]),
    );
    const hires = documentedChanges().filter((c) => c.change === "hire");
    expect(hires.length).toBeGreaterThanOrEqual(3);
    for (const hire of hires) {
      const position = /Position_ID (P-\d{6})/.exec(hire.detail)![1];
      expect(before.has(position)).toBe(false);
    }
  });
});
