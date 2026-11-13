// `pnpm pipeline [--report <file>]`: ingest Workday report CSVs, then `dbt build`, and print a
// summary. With --report it ingests that one file; without it, every
// data/workday/worker_report_*.csv in date order (the seed writes both). It stops at the first
// failure (a rejected report, a dbt model or test error) and exits 1.
// Connection: DATABASE_URL_UNPOOLED, falling back to DATABASE_URL, like workday:ingest. dbt reads
// DBT_* from the environment (analytics/profiles.yml). Nothing here prints a connection string.
// This is not routed through the test-only local-database guard, so it runs against Neon in CI.
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { Pool } from "pg";
import { ingestReport } from "./ingest/load";
import { CsvFileReader } from "./ingest/reader";
import {
  formatSummary,
  parseDbtOutput,
  runSteps,
  type DbtCounts,
  type Step,
  type Summary,
} from "./pipeline-lib";

config({ path: [".env.local", ".env"], quiet: true });

const REPORT_DIR = path.join("data", "workday");

function parseArgs(argv: string[]): { report: string | null } | { error: string } {
  const i = argv.indexOf("--report");
  if (i === -1) return { report: null };
  const file = argv[i + 1];
  if (!file || file.startsWith("--")) return { error: "--report needs a file path." };
  return { report: file };
}

async function reportFiles(report: string | null): Promise<string[]> {
  if (report) return [report];
  let names: string[];
  try {
    names = await readdir(REPORT_DIR);
  } catch {
    names = [];
  }
  const files = names
    .filter((n) => /^worker_report_\d{4}-\d{2}-\d{2}\.csv$/.test(n))
    .sort() // ISO dates sort in date order
    .map((n) => path.join(REPORT_DIR, n));
  if (files.length === 0) {
    throw new Error(`no reports in ${REPORT_DIR}; run pnpm db:seed (or pnpm workday:reports).`);
  }
  return files;
}

// Runs `uv run dbt build` in analytics/, echoing its output as it arrives and keeping a copy to
// count models and tests afterwards.
function runDbtBuild(): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "dbt", "build", "--no-use-colors"], {
      cwd: "analytics",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const tee = (stream: NodeJS.WriteStream) => (chunk: Buffer) => {
      output += chunk.toString();
      stream.write(chunk);
    };
    child.stdout.on("data", tee(process.stdout));
    child.stderr.on("data", tee(process.stderr));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(`pipeline: ${args.error} Usage: pnpm pipeline [--report <file>]`);
    process.exit(1);
  }
  const source = process.env.DATABASE_URL_UNPOOLED ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL";
  const connectionString = process.env[source];
  if (!connectionString) {
    console.error("pipeline: set DATABASE_URL_UNPOOLED or DATABASE_URL (see .env.example).");
    process.exit(1);
  }

  const summary: Summary = {
    reports: [],
    dbt: null,
    exceptions: null,
    exceptionsNote: null,
    failed: null,
  };
  const pool = new Pool({ connectionString });
  try {
    const files = await reportFiles(args.report);
    const steps: Step[] = files.map((file) => ({
      name: `ingest ${path.basename(file)}`,
      run: async () => {
        const r = await ingestReport(pool, new CsvFileReader(file));
        const detail =
          r.status === "loaded"
            ? `loaded ${r.rowCount} rows, report date ${r.reportDate}`
            : r.status === "skipped"
              ? "skipped, this exact file is already loaded"
              : `REJECTED, nothing loaded: ${r.reasons.join("; ")}`;
        summary.reports.push({ file: path.basename(file), detail });
        return { ok: r.status !== "rejected", detail };
      },
    }));
    steps.push({
      name: "dbt build",
      run: async () => {
        const { code, output } = await runDbtBuild();
        const counts: DbtCounts = parseDbtOutput(output);
        summary.dbt = counts;
        return { ok: code === 0, detail: `dbt exited with code ${code}` };
      },
    });

    const outcome = await runSteps(steps);
    summary.failed = outcome.results.find((r) => !r.ok) ?? null;

    // Exception counts come from the reconciliation mart; skipped if a step failed.
    if (outcome.ok) {
      try {
        const res = await pool.query<{ exception_type: string; n: number }>(
          `select exception_type, count(*)::int as n
           from analytics.rpt_reconciliation_exceptions
           group by exception_type order by exception_type`,
        );
        summary.exceptions = res.rows.map((r) => ({ type: r.exception_type, count: r.n }));
      } catch {
        summary.exceptionsNote = "could not read analytics.rpt_reconciliation_exceptions.";
      }
    } else {
      summary.exceptionsNote = "not read (a step failed).";
    }
    console.log(formatSummary(summary));
    if (!outcome.ok) process.exitCode = 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `pipeline failed: ${message.replaceAll(connectionString, "[connection string]")}`,
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
