// `pnpm workday:ingest <file>`: validate and load one Workday worker report CSV into
// workday.raw_worker_report and workday.workers, and record the run in workday.ingest_runs.
// Exit code 0 for loaded or skipped (same file already loaded), 1 for a rejected file or an error.
// Like db:migrate it uses DATABASE_URL_UNPOOLED, falling back to DATABASE_URL, and never prints
// the connection string.
import { config } from "dotenv";
import { Pool } from "pg";
import { ingestReport } from "./load";
import { CsvFileReader } from "./reader";

config({ path: [".env.local", ".env"], quiet: true });

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error(
      "workday:ingest: usage: pnpm workday:ingest <path to worker_report_YYYY-MM-DD.csv>",
    );
    process.exit(1);
  }
  const source = process.env.DATABASE_URL_UNPOOLED ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL";
  const connectionString = process.env[source];
  if (!connectionString) {
    console.error("workday:ingest: set DATABASE_URL_UNPOOLED or DATABASE_URL (see .env.example).");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  try {
    const result = await ingestReport(pool, new CsvFileReader(file));
    const label = `${result.sourceFile} (sha256 ${result.fileSha256.slice(0, 12)})`;
    if (result.status === "rejected") {
      console.error(`workday:ingest: REJECTED ${label}; nothing was loaded.`);
      for (const reason of result.reasons) console.error(`  - ${reason}`);
      process.exitCode = 1;
    } else if (result.status === "skipped") {
      console.log(`workday:ingest: skipped ${label}: this exact file is already loaded.`);
    } else {
      console.log(
        `workday:ingest: loaded ${result.rowCount} rows from ${label}, report date ${result.reportDate}.`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `workday:ingest failed: ${message.replaceAll(connectionString, "[connection string]")}`,
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
