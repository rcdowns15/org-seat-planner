import { describe, expect, it, vi } from "vitest";
import { formatSummary, parseDbtOutput, runSteps, type Step } from "../../scripts/pipeline-lib";

describe("runSteps", () => {
  it("runs every step in order when all succeed", async () => {
    const order: string[] = [];
    const step = (name: string): Step => ({
      name,
      run: async () => {
        order.push(name);
        return { ok: true, detail: "fine" };
      },
    });
    const out = await runSteps([step("ingest 1"), step("ingest 2"), step("dbt build")]);
    expect(out.ok).toBe(true);
    expect(order).toEqual(["ingest 1", "ingest 2", "dbt build"]);
  });

  it("stops at the first failing step (a failing dbt test) and never runs later steps", async () => {
    const after = vi.fn(async () => ({ ok: true, detail: "should not run" }));
    const out = await runSteps([
      { name: "ingest", run: async () => ({ ok: true, detail: "loaded" }) },
      { name: "dbt build", run: async () => ({ ok: false, detail: "dbt exited with code 1" }) },
      { name: "alert", run: after },
    ]);
    expect(out.ok).toBe(false);
    expect(out.results.map((r) => r.name)).toEqual(["ingest", "dbt build"]);
    expect(after).not.toHaveBeenCalled();
  });

  it("treats a thrown error as a failed step", async () => {
    const out = await runSteps([
      {
        name: "ingest",
        run: async () => {
          throw new Error("boom");
        },
      },
    ]);
    expect(out).toMatchObject({ ok: false, results: [{ name: "ingest", ok: false }] });
    expect(out.results[0].detail).toContain("boom");
  });
});

const DBT_OUTPUT = `
12:00:01  1 of 6 START sql view model analytics_staging.stg_app__seats ......... [RUN]
12:00:01  1 of 6 OK created sql view model analytics_staging.stg_app__seats .... [CREATE VIEW in 0.1s]
12:00:02  2 of 6 OK created sql table model analytics.dim_squads ............... [SELECT 180 in 0.1s]
12:00:02  3 of 6 OK snapshotted analytics.some_snapshot ........................ [SUCCESS 1 in 0.1s]
12:00:03  4 of 6 PASS not_null_dim_squads_squad_id ............................. [PASS in 0.1s]
12:00:03  5 of 6 WARN 3 assert_seed_list_tests_are_active ...................... [WARN 3 in 0.1s]
12:00:03  6 of 6 FAIL 2 unique_dim_squads_squad_id ............................. [FAIL 2 in 0.1s]
12:00:03  7 of 7 SKIP relation analytics.rpt_x ................................. [SKIP]
`;

describe("parseDbtOutput", () => {
  it("counts models built and tests by outcome", () => {
    expect(parseDbtOutput(DBT_OUTPUT)).toEqual({
      modelsBuilt: 2,
      testsPassed: 1,
      testsWarned: 1,
      testsFailed: 1,
      skipped: 1,
    });
  });
});

describe("formatSummary", () => {
  it("shows rows per report, dbt counts and exception counts by type", () => {
    const text = formatSummary({
      reports: [{ file: "worker_report_2026-11-01.csv", detail: "loaded 2024 rows" }],
      dbt: { modelsBuilt: 19, testsPassed: 234, testsWarned: 0, testsFailed: 0, skipped: 0 },
      exceptions: [
        { type: "hiring_gap", count: 8 },
        { type: "terminated_seated", count: 8 },
      ],
      exceptionsNote: null,
      failed: null,
    });
    expect(text).toContain("worker_report_2026-11-01.csv: loaded 2024 rows");
    expect(text).toContain("19 models built, 234 tests passed");
    expect(text).toContain("Reconciliation exceptions: 16");
    expect(text).toContain("  hiring_gap: 8");
    expect(text).toContain("RESULT: ok");
  });

  it("reports the failed step", () => {
    const text = formatSummary({
      reports: [],
      dbt: null,
      exceptions: null,
      exceptionsNote: "not read (a step failed).",
      failed: { name: "dbt build", ok: false, detail: "dbt exited with code 1" },
    });
    expect(text).toContain('RESULT: FAILED at "dbt build"');
  });
});
