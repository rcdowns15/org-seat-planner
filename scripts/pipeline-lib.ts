// Pure helpers for `pnpm pipeline` (scripts/pipeline.ts): the step runner, the dbt output parser
// and the summary text. No I/O here, so unit tests can drive them with stubbed steps.

export type StepOutcome = {
  ok: boolean;
  // One line for the summary, e.g. "loaded 2024 rows".
  detail: string;
};

export type Step = {
  name: string;
  run: () => Promise<StepOutcome>;
};

export type StepResult = StepOutcome & { name: string };

// Runs the steps in order and stops at the first one that fails or throws. Steps after the
// failure are not run and are not in the result.
export async function runSteps(steps: Step[]): Promise<{ ok: boolean; results: StepResult[] }> {
  const results: StepResult[] = [];
  for (const step of steps) {
    try {
      const outcome = await step.run();
      results.push({ name: step.name, ...outcome });
      if (!outcome.ok) return { ok: false, results };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name: step.name, ok: false, detail: `error: ${message}` });
      return { ok: false, results };
    }
  }
  return { ok: true, results };
}

export type DbtCounts = {
  modelsBuilt: number;
  testsPassed: number;
  testsWarned: number;
  testsFailed: number;
  skipped: number;
};

// Counts nodes in `dbt build` text output. Each node logs one line such as
//   "12:00:01  3 of 90 OK created sql table model analytics.dim_squads .... [SELECT 180 in 0.1s]"
//   "12:00:02  40 of 90 PASS not_null_dim_squads_squad_id .... [PASS in 0.1s]"
// Models and snapshots count as built; tests (data and unit tests) count by outcome.
export function parseDbtOutput(output: string): DbtCounts {
  const counts: DbtCounts = {
    modelsBuilt: 0,
    testsPassed: 0,
    testsWarned: 0,
    testsFailed: 0,
    skipped: 0,
  };
  for (const line of output.split(/\r?\n/)) {
    const m = /\d+ of \d+ (OK|PASS|WARN|FAIL|ERROR|SKIP)\b\s+(.*)/.exec(line);
    if (!m) continue;
    const [, status, rest] = m;
    if (status === "OK" && /^created\b.*\b(model|snapshot)\b/.test(rest)) counts.modelsBuilt++;
    else if (status === "PASS") counts.testsPassed++;
    else if (status === "WARN") counts.testsWarned++;
    else if (status === "FAIL") counts.testsFailed++;
    else if (status === "SKIP") counts.skipped++;
  }
  return counts;
}

export type Summary = {
  reports: { file: string; detail: string }[];
  dbt: DbtCounts | null;
  exceptions: { type: string; count: number }[] | null;
  exceptionsNote: string | null;
  failed: StepResult | null;
};

export function formatSummary(s: Summary): string {
  const lines = ["", "Pipeline summary", "----------------"];
  for (const r of s.reports) lines.push(`Ingested ${r.file}: ${r.detail}`);
  if (s.dbt) {
    lines.push(
      `dbt build: ${s.dbt.modelsBuilt} models built, ${s.dbt.testsPassed} tests passed, ` +
        `${s.dbt.testsWarned} warned, ${s.dbt.testsFailed} failed, ${s.dbt.skipped} skipped`,
    );
  }
  if (s.exceptions) {
    const total = s.exceptions.reduce((n, e) => n + e.count, 0);
    lines.push(`Reconciliation exceptions: ${total}`);
    for (const e of s.exceptions) lines.push(`  ${e.type}: ${e.count}`);
  } else if (s.exceptionsNote) {
    lines.push(`Reconciliation exceptions: ${s.exceptionsNote}`);
  }
  lines.push(s.failed ? `RESULT: FAILED at "${s.failed.name}" (${s.failed.detail})` : "RESULT: ok");
  return lines.join("\n");
}
