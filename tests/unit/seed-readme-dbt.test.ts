import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { documentedChanges, documentedExceptions } from "../support/seed-readme";

// The dbt singular tests that check the marts against scripts/seed/README.md carry their expected
// rows as SQL `VALUES`. These tests read those rows back out of the .sql files and compare them with
// the README tables, so the README and the dbt tests can't drift apart.
const TESTS_DIR = path.resolve(__dirname, "../../analytics/tests");

// The rows of the `expected (...) as ( values (...), ... )` CTE, as arrays of string literals.
function expectedValues(file: string): string[][] {
  const sql = readFileSync(path.join(TESTS_DIR, file), "utf8");
  const block = /expected\s*\([^)]*\)\s*as\s*\(\s*values([\s\S]*?)\n\s*\)/i.exec(sql);
  if (!block) throw new Error(`${file} has no expected VALUES block`);
  return [...block[1].matchAll(/\(([^)]*)\)/g)].map((row) =>
    [...row[1].matchAll(/'([^']*)'/g)].map((literal) => literal[1]),
  );
}

const sorted = (rows: string[][]) => rows.map((r) => r.join("|")).sort();

describe("dbt seed-list tests agree with scripts/seed/README.md", () => {
  it("lists the documented reconciliation exceptions in assert_reconciliation_exceptions_match_seed_readme", () => {
    const sqlRows = expectedValues("assert_reconciliation_exceptions_match_seed_readme.sql");
    // The SQL list carries seat_id as text, '' for a hiring_gap (no seat).
    const readmeRows = documentedExceptions().map((e) => [
      e.exceptionType,
      e.subjectId,
      e.severity,
      e.seatId === null ? "" : String(e.seatId),
    ]);
    expect(readmeRows.length).toBeGreaterThan(0);
    expect(sorted(sqlRows)).toEqual(sorted(readmeRows));
  });

  it("lists the documented 11-15 changes in assert_workday_changes_match_seed_readme", () => {
    // The README's `leave` kind is `leave_start` in rpt_workday_changes (every documented leave
    // is Active -> On Leave).
    const kind = (change: string) => (change === "leave" ? "leave_start" : change);
    const sqlRows = expectedValues("assert_workday_changes_match_seed_readme.sql");
    const readmeRows = documentedChanges().map((c) => [c.workerId, kind(c.change)]);
    expect(readmeRows.length).toBeGreaterThan(0);
    expect(sorted(sqlRows)).toEqual(sorted(readmeRows));
  });

  it("documents each exception once, with a severity that matches its type", () => {
    const rows = documentedExceptions();
    const keys = rows.map((e) => `${e.exceptionType}|${e.subjectId}`);
    expect(new Set(keys).size).toBe(keys.length);
    const severityByType: Record<string, string> = {
      terminated_seated: "error",
      seated_missing_from_report: "error",
      missing_without_termination: "warning",
      worker_type_mismatch: "error",
      on_leave_seated: "info",
      hiring_gap: "info",
    };
    for (const e of rows) {
      expect(e.severity, `${e.exceptionType} ${e.subjectId}`).toBe(severityByType[e.exceptionType]);
    }
  });
});
