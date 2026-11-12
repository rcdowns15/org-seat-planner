import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { inList } from "./checks";

// The `workday` schema is the mock HRIS: read-only to the app (D-015). Only scripts/ingest/ and
// scripts/seed/ write it. The raw report landing tables (raw_worker_report, ingest_runs) sit next to the typed table.
export const workday = pgSchema("workday");

// Enum values (text + CHECK; see db/schema/checks.ts for why).
export const WORKER_TYPES = ["employee", "contingent"] as const;
export const WORKER_STATUSES = ["active", "leave", "terminated"] as const;
export const INGEST_RUN_STATUSES = ["loaded", "skipped", "rejected"] as const;

// The typed, current view of Workday: one row per worker from the latest accepted report.
// The HRIS is the source of truth, so beyond types and enums this table doesn't reject facts
// (e.g. a terminated worker who still holds a seat); dbt flags those as reconciliation exceptions.
export const workers = workday.table(
  "workers",
  {
    workerId: text("worker_id").primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    workerType: text("worker_type").notNull(),
    status: text("status").notNull(),
    hireDate: date("hire_date").notNull(),
    terminationDate: date("termination_date"),
    // No self-FK: each report is a full extract loaded as-is, and a manager can be missing from it.
    managerWorkerId: text("manager_worker_id"),
    jobTitle: text("job_title").notNull(),
    supervisoryOrg: text("supervisory_org").notNull(),
    // D-029: Workday position. Not linked to app.seats; seats match Workday by worker_id only.
    positionId: text("position_id").notNull(),
    costCenter: text("cost_center").notNull(),
    location: text("location").notNull(),
    asOfReportDate: date("as_of_report_date").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("workers_worker_type_check", inList(t.workerType, WORKER_TYPES)),
    check("workers_status_check", inList(t.status, WORKER_STATUSES)),
    // A position is held by at most one current worker; terminated workers keep their old one.
    uniqueIndex("workers_position_id_active_key")
      .on(t.positionId)
      .where(sql`${t.status} <> 'terminated'`),
  ],
);

// Every row of every accepted report, exactly as the file had it: all text, no trimming or casting
// (D-028). Cleaning happens in dbt staging. The column names are the report's headers in
// snake_case; a blank cell is an empty string, not null. Rows are kept for every report, so this
// is the history; `workday.workers` is the typed current view.
export const rawWorkerReport = workday.table(
  "raw_worker_report",
  {
    rawId: integer("raw_id").primaryKey().generatedAlwaysAsIdentity(),
    reportDate: date("report_date").notNull(),
    sourceFile: text("source_file").notNull(),
    fileSha256: text("file_sha256").notNull(),
    // 1-based position of the row in the file, after the header.
    sourceRow: integer("source_row").notNull(),
    loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
    workerId: text("worker_id").notNull(),
    workerName: text("worker_name").notNull(),
    workEmail: text("work_email").notNull(),
    workerType: text("worker_type").notNull(),
    workerStatus: text("worker_status").notNull(),
    hireDate: text("hire_date").notNull(),
    terminationDate: text("termination_date").notNull(),
    contractEndDate: text("contract_end_date").notNull(),
    managerId: text("manager_id").notNull(),
    jobTitle: text("job_title").notNull(),
    supervisoryOrganization: text("supervisory_organization").notNull(),
    positionId: text("position_id").notNull(),
    costCenter: text("cost_center").notNull(),
    location: text("location").notNull(),
  },
  (t) => [
    uniqueIndex("raw_worker_report_file_row_key").on(t.fileSha256, t.sourceRow),
    index("raw_worker_report_report_date_idx").on(t.reportDate),
  ],
);

// One row per ingest attempt: loaded, skipped (same file hash already loaded) or rejected
// (validation failed; nothing was loaded and the previous report stays current).
export const ingestRuns = workday.table(
  "ingest_runs",
  {
    runId: integer("run_id").primaryKey().generatedAlwaysAsIdentity(),
    sourceFile: text("source_file").notNull(),
    fileSha256: text("file_sha256").notNull(),
    // Null when the file name doesn't carry a date (then the run is rejected).
    reportDate: date("report_date"),
    rowCount: integer("row_count").notNull(),
    status: text("status").notNull(),
    // JSON array of messages, each naming the row and column; empty unless rejected.
    rejectionReasons: jsonb("rejection_reasons").$type<string[]>().notNull().default([]),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("ingest_runs_status_check", inList(t.status, INGEST_RUN_STATUSES)),
    index("ingest_runs_file_sha256_idx").on(t.fileSha256),
  ],
);
