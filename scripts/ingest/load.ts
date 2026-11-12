import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { ingestRuns, rawWorkerReport, workers } from "../../db/schema/workday";
import type { ReportReader } from "./reader";
import { parseUsDate, validateReport, type RawRow, type ValidatedReport } from "./validate";

export type IngestResult = {
  status: "loaded" | "skipped" | "rejected";
  sourceFile: string;
  fileSha256: string;
  reportDate: string | null;
  rowCount: number;
  reasons: string[];
};

// Postgres allows 65,535 bind parameters per statement; 1,000 rows of up to 20 columns is far below.
const BATCH_SIZE = 1000;

function chunk<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) out.push(rows.slice(i, i + BATCH_SIZE));
  return out;
}

const TYPE_VALUE = { Employee: "employee", "Contingent Worker": "contingent" } as const;
const STATUS_VALUE = { Active: "active", "On Leave": "leave", Terminated: "terminated" } as const;

// "Last, First" to its two parts; validation already guaranteed the comma.
function splitName(workerName: string): { lastName: string; firstName: string } {
  const text = workerName.trim();
  const comma = text.indexOf(",");
  return { lastName: text.slice(0, comma).trim(), firstName: text.slice(comma + 1).trim() };
}

// The typed current row for one report row: trimmed text, ISO dates, enum values. This is the one
// place the loader interprets values; the raw table keeps the file's text as it was.
function toWorker(row: RawRow, reportDate: string) {
  const { lastName, firstName } = splitName(row.Worker_Name);
  const termination = row.Termination_Date.trim();
  return {
    workerId: row.Worker_ID.trim(),
    firstName,
    lastName,
    email: row.Work_Email.trim(),
    workerType: TYPE_VALUE[row.Worker_Type.trim() as keyof typeof TYPE_VALUE],
    status: STATUS_VALUE[row.Worker_Status.trim() as keyof typeof STATUS_VALUE],
    hireDate: parseUsDate(row.Hire_Date.trim())!,
    terminationDate: termination === "" ? null : parseUsDate(termination)!,
    managerWorkerId: row.Manager_ID.trim() === "" ? null : row.Manager_ID.trim(),
    jobTitle: row.Job_Title.trim(),
    supervisoryOrg: row.Supervisory_Organization.trim(),
    positionId: row.Position_ID.trim(),
    costCenter: row.Cost_Center.trim(),
    location: row.Location.trim(),
    asOfReportDate: reportDate,
  };
}

async function loadReport(
  tx: NodePgDatabase,
  report: ValidatedReport,
  sourceFile: string,
  fileSha256: string,
): Promise<void> {
  const raw = report.rows.map((row, i) => ({
    reportDate: report.reportDate,
    sourceFile,
    fileSha256,
    sourceRow: i + 1,
    workerId: row.Worker_ID,
    workerName: row.Worker_Name,
    workEmail: row.Work_Email,
    workerType: row.Worker_Type,
    workerStatus: row.Worker_Status,
    hireDate: row.Hire_Date,
    terminationDate: row.Termination_Date,
    contractEndDate: row.Contract_End_Date,
    managerId: row.Manager_ID,
    jobTitle: row.Job_Title,
    supervisoryOrganization: row.Supervisory_Organization,
    positionId: row.Position_ID,
    costCenter: row.Cost_Center,
    location: row.Location,
  }));
  for (const batch of chunk(raw)) await tx.insert(rawWorkerReport).values(batch);

  // Upsert, never delete: a worker missing from this report keeps their row (with an older
  // as_of_report_date) and shows up as a reconciliation exception in dbt.
  for (const batch of chunk(report.rows.map((r) => toWorker(r, report.reportDate)))) {
    await tx
      .insert(workers)
      .values(batch)
      .onConflictDoUpdate({
        target: workers.workerId,
        set: {
          firstName: sql`excluded.first_name`,
          lastName: sql`excluded.last_name`,
          email: sql`excluded.email`,
          workerType: sql`excluded.worker_type`,
          status: sql`excluded.status`,
          hireDate: sql`excluded.hire_date`,
          terminationDate: sql`excluded.termination_date`,
          managerWorkerId: sql`excluded.manager_worker_id`,
          jobTitle: sql`excluded.job_title`,
          supervisoryOrg: sql`excluded.supervisory_org`,
          positionId: sql`excluded.position_id`,
          costCenter: sql`excluded.cost_center`,
          location: sql`excluded.location`,
          asOfReportDate: sql`excluded.as_of_report_date`,
          updatedAt: sql`now()`,
        },
      });
  }
}

// A readable message for a failed load. Drizzle wraps the driver error and its own message
// repeats the SQL and the row values, so use the database error underneath when there is one
// (constraint name plus detail). No connection details are included.
function describeLoadError(err: unknown): string {
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  if (!(cause instanceof Error)) return "load failed: unknown error";
  const { code, detail } = cause as { code?: unknown; detail?: unknown };
  // Only a unique violation's detail ("Key (...)=(...) already exists") is safe to show; other
  // errors' details can be "Failing row contains (...)", which would store whole rows.
  const shown = code === "23505" && typeof detail === "string" ? ` (${detail})` : "";
  return `load failed, nothing was loaded: ${cause.message}${shown}`;
}

// Reads, validates and loads one report. A rejected file loads nothing and leaves the previous
// report current; the same file twice is a no-op. Every attempt is recorded in ingest_runs.
export async function ingestReport(pool: Pool, reader: ReportReader): Promise<IngestResult> {
  const db = drizzle(pool);
  const source = await reader.read();
  const base = { sourceFile: source.sourceFile, fileSha256: source.fileSha256 };

  const validation = source.parseError
    ? { ok: false as const, reasons: [`file: ${source.parseError}`], rowCount: 0 }
    : validateReport(source.sourceFile, source.records);

  const insertRun = (
    tx: NodePgDatabase,
    status: IngestResult["status"],
    reportDate: string | null,
    rowCount: number,
    reasons: string[],
  ): Promise<unknown> =>
    tx.insert(ingestRuns).values({
      ...base,
      reportDate,
      rowCount,
      status,
      rejectionReasons: reasons,
    });

  try {
    return await db.transaction(async (tx) => {
      // One lock key for every ingest, so two different files can't both pass the "newer
      // report" check at once: the second waits for the first and then sees its run.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('workday_ingest'))`);

      const record = async (
        status: IngestResult["status"],
        reportDate: string | null,
        rowCount: number,
        reasons: string[],
      ): Promise<IngestResult> => {
        await insertRun(tx, status, reportDate, rowCount, reasons);
        return { status, ...base, reportDate, rowCount, reasons };
      };

      if (!validation.ok) return record("rejected", null, validation.rowCount, validation.reasons);
      const { report } = validation;
      const rowCount = report.rows.length;

      const [alreadyLoaded] = await tx
        .select({ runId: ingestRuns.runId })
        .from(ingestRuns)
        .where(and(eq(ingestRuns.fileSha256, source.fileSha256), eq(ingestRuns.status, "loaded")))
        .limit(1);
      if (alreadyLoaded) return record("skipped", report.reportDate, rowCount, []);

      // An older (or same-dated, different) report must not overwrite newer facts, so only a
      // newer report is accepted.
      const [latest] = await tx
        .select({ reportDate: ingestRuns.reportDate })
        .from(ingestRuns)
        .where(eq(ingestRuns.status, "loaded"))
        .orderBy(desc(ingestRuns.reportDate))
        .limit(1);
      if (latest?.reportDate && latest.reportDate >= report.reportDate) {
        return record("rejected", report.reportDate, rowCount, [
          `report date ${report.reportDate}: not newer than the loaded report ${latest.reportDate}; the previous report stays current`,
        ]);
      }

      await loadReport(tx, report, base.sourceFile, base.fileSha256);
      return record("loaded", report.reportDate, rowCount, []);
    });
  } catch (err) {
    // Only database errors from the load become rejections; anything else is a bug or an
    // environment problem and is rethrown. pg DatabaseErrors carry a 5-character SQLSTATE code.
    const dbError = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const sqlState = (dbError as { code?: unknown } | null)?.code;
    if (
      !(dbError instanceof Error) ||
      typeof sqlState !== "string" ||
      !/^[0-9A-Z]{5}$/.test(sqlState)
    ) {
      throw err;
    }
    // The load transaction rolled back, so nothing was loaded and no run was recorded. Record
    // the rejection in a fresh transaction instead of crashing.
    const reasons = [describeLoadError(err)];
    const reportDate = validation.ok ? validation.report.reportDate : null;
    const rowCount = validation.ok ? validation.report.rows.length : validation.rowCount;
    await db.transaction((tx) => insertRun(tx, "rejected", reportDate, rowCount, reasons));
    return { status: "rejected", ...base, reportDate, rowCount, reasons };
  }
}
