import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { divisions, groups, headcountPlan, leaders, seats, squads } from "../../db/schema/app";
import { ingestReport } from "../ingest/load";
import { CsvFileReader } from "../ingest/reader";
import { seedChecksum } from "./checksum";
import { NEXT_REPORT_DATE, SEED_DATE } from "./config";
import { generateSeedData, type SeedData } from "./generate";
import { buildReportCsv, reportFileName } from "./workday-reports";

export const DEFAULT_REPORT_DIR = path.join("data", "workday");

export type SeedResult = {
  checksum: string;
  counts: Record<string, number>;
  reports: { file: string; sha256: string }[];
};

// Postgres allows 65,535 bind parameters per statement: batches of 1,000 rows stay far below that
// even for the widest table here (16 columns).
const BATCH_SIZE = 1000;

function chunk<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) out.push(rows.slice(i, i + BATCH_SIZE));
  return out;
}

// Inserts rows in order and checks the database handed out ids 1..n in that order. The seed
// refers to parents by array position, so this is what keeps the foreign keys right.
async function insertInOrder(
  tx: NodePgDatabase,
  table: PgTable,
  idColumn: AnyPgColumn,
  rows: Record<string, unknown>[],
): Promise<void> {
  let expected = 1;
  for (const batch of chunk(rows)) {
    // Every row value is bound as a parameter by Drizzle. `never` because `table` is generic here.
    const inserted = await tx
      .insert(table)
      .values(batch as never)
      .returning({ id: idColumn });
    for (const { id } of inserted) {
      if (id !== expected++) throw new Error(`Unexpected id ${String(id)} in ${idColumn.name}`);
    }
  }
}

function toRows(data: SeedData) {
  const { org } = data;
  return {
    divisions: org.divisions.map((d) => ({ name: d.name })),
    groups: org.groups.map((g) => ({ divisionId: g.divisionIndex + 1, name: g.name })),
    squads: org.squads.map((s) => ({ groupId: s.groupIndex + 1, name: s.name })),
    leaders: data.leaders.map((l) => ({
      workerId: l.workerId,
      displayName: l.displayName,
      scopeType: l.scopeType,
      divisionId: l.divisionIndex === null ? null : l.divisionIndex + 1,
      groupId: l.groupIndex === null ? null : l.groupIndex + 1,
    })),
    seats: data.seats.map((s) => ({
      squadId: s.squadIndex + 1,
      seatType: s.seatType,
      status: s.status,
      workerId: s.workerId,
    })),
    plan: data.plan.map((p) => ({
      squadId: p.squadIndex + 1,
      quarterStart: p.quarterStart,
      approvedSeats: p.approvedSeats,
    })),
  };
}

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
      // app.seat_changes is append-only; its TRUNCATE guard (migration 0002) only lets the
      // transaction through after this setting, which ends with the transaction.
      await tx.execute(sql`SET LOCAL app.allow_seat_changes_reset = 'on'`);
      await tx.execute(sql`
        TRUNCATE app.seat_changes, app.seats, app.leaders, app.headcount_plan, app.squads,
                 app.groups, app.divisions, workday.workers,
                 workday.raw_worker_report, workday.ingest_runs
        RESTART IDENTITY
      `);
      await insertInOrder(tx, divisions, divisions.divisionId, rows.divisions);
      await insertInOrder(tx, groups, groups.groupId, rows.groups);
      await insertInOrder(tx, squads, squads.squadId, rows.squads);
      await insertInOrder(tx, leaders, leaders.leaderId, rows.leaders);
      await insertInOrder(tx, seats, seats.seatId, rows.seats);
      for (const batch of chunk(rows.plan)) await tx.insert(headcountPlan).values(batch);
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
