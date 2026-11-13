import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ingestReport } from "../ingest/load";
import { CsvFileReader } from "../ingest/reader";
import { insertAppRows, toRows, truncateAppTables } from "./app-rows";
import { seedChecksum } from "./checksum";
import { NEXT_REPORT_DATE, SEED_DATE } from "./config";
import { generateSeedData } from "./generate";
import { buildReportCsv, reportFileName } from "./workday-reports";

export const DEFAULT_REPORT_DIR = path.join("data", "workday");

export type SeedResult = {
  checksum: string;
  counts: Record<string, number>;
  reports: { file: string; sha256: string }[];
};

// Wipes and reseeds app + workday in one transaction, then writes both report CSVs.
export async function runSeed(
  connectionString: string,
  reportDir: string = DEFAULT_REPORT_DIR,
): Promise<SeedResult> {
  const data = generateSeedData();
  const rows = toRows(data);
  const pool = new Pool({ connectionString });
  try {
    const db = drizzle(pool);
    await db.transaction(async (tx) => {
      await truncateAppTables(tx);
      // Workday tables and the demo reset throttle are wiped by the full seed only.
      await tx.execute(sql`
        TRUNCATE app.demo_reset_state, workday.workers, workday.raw_worker_report,
                 workday.ingest_runs
        RESTART IDENTITY
      `);
      await insertAppRows(tx, rows);
    });

    await mkdir(reportDir, { recursive: true });
    const reports: SeedResult["reports"] = [];
    for (const [date, list] of [
      [SEED_DATE, data.workers],
      [NEXT_REPORT_DATE, data.nextReportWorkers],
    ] as const) {
      const csv = buildReportCsv(list);
      const file = path.join(reportDir, reportFileName(date));
      await writeFile(file, csv, "utf8");
      reports.push({ file, sha256: createHash("sha256").update(csv).digest("hex") });
    }

    // workday.workers is loaded the way production data would be: through the ingest script, from
    // the 11-01 report. The 11-15 report is left for the demo's "simulate Workday refresh".
    const first = reports[0];
    const ingest = await ingestReport(pool, new CsvFileReader(first.file));
    if (ingest.status !== "loaded") {
      throw new Error(`Ingest of ${first.file} was ${ingest.status}: ${ingest.reasons.join("; ")}`);
    }

    const checksum = await seedChecksum(db);

    const counts = {
      divisions: rows.divisions.length,
      groups: rows.groups.length,
      squads: rows.squads.length,
      leaders: rows.leaders.length,
      seats: rows.seats.length,
      headcount_plan: rows.plan.length,
      workers: data.workers.length,
    };
    return { checksum, counts, reports };
  } finally {
    await pool.end();
  }
}

export async function checkSeed(connectionString: string): Promise<string> {
  const pool = new Pool({ connectionString });
  try {
    return await seedChecksum(drizzle(pool));
  } finally {
    await pool.end();
  }
}
