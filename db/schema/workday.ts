import { sql } from "drizzle-orm";
import { check, date, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { inList } from "./checks";

// The `workday` schema is the mock HRIS: read-only to the app (D-015). Only scripts/ingest/ and
// scripts/seed/ write it. BR-03 adds the raw report landing tables next to this one.
export const workday = pgSchema("workday");

// Enum values (text + CHECK; see db/schema/checks.ts for why).
export const WORKER_TYPES = ["employee", "contingent"] as const;
export const WORKER_STATUSES = ["active", "leave", "terminated"] as const;

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
