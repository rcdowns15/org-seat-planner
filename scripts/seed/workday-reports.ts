import type { Faker } from "@faker-js/faker";
import { formatCsv } from "./csv";
import { toUsDate } from "./dates";
import { MEMBER_JOB_TITLES } from "./names";
import type { Org } from "./org";
import { PersonFactory, randomDate, workerNumber, type SeedWorker } from "./workers";

// The mock Workday "worker custom report". Column names are documented, in this order, in
// scripts/seed/README.md; a test keeps the two in sync.
export const REPORT_COLUMNS = [
  "Employee_ID",
  "Worker_Name",
  "Work_Email",
  "Worker_Type",
  "Worker_Status",
  "Hire_Date",
  "Termination_Date",
  "Manager_ID",
  "Job_Title",
  "Supervisory_Organization",
  "Position_ID",
  "Cost_Center",
  "Location",
] as const;

const TYPE_TEXT = { employee: "Employee", contingent: "Contingent Worker" } as const;
const STATUS_TEXT = { active: "Active", leave: "On Leave", terminated: "Terminated" } as const;

// One report row in Workday's messy style: "Last, First" names, MM/DD/YYYY dates, status and
// worker type as display text. `index` (the worker's position in the file) decides which rows
// get stray whitespace, so the same worker is padded the same way in every report.
export function toReportRow(w: SeedWorker, index: number): string[] {
  return [
    w.workerId,
    `${w.lastName}, ${w.firstName}` + (index % 67 === 3 ? " " : ""),
    w.email,
    TYPE_TEXT[w.workerType],
    STATUS_TEXT[w.status],
    toUsDate(w.hireDate),
    w.terminationDate ? toUsDate(w.terminationDate) : "",
    w.managerWorkerId ?? "",
    w.jobTitle + (index % 41 === 7 ? "  " : ""),
    w.supervisoryOrg,
    w.positionId,
    w.costCenter,
    (index % 53 === 11 ? " " : "") + w.location,
  ];
}

export function buildReportCsv(workers: SeedWorker[]): string {
  return formatCsv(
    REPORT_COLUMNS,
    workers.map((w, i) => toReportRow(w, i)),
  );
}

export type ReportChange = {
  change: "hire" | "termination" | "manager_change" | "leave";
  workerId: string;
  detail: string;
};

const CHANGE_ORDER = ["hire", "termination", "manager_change", "leave"] as const;

// Applies the 11-15 changes to the 11-01 state: 6 hires, 5 terminations of seated workers,
// 4 manager changes and 1 leave. Returns the new worker list (hires appended at the end).
export function buildNextReportWorkers(
  org: Org,
  workers: SeedWorker[],
  faker: Faker,
): SeedWorker[] {
  const next = workers.map((w) => ({ ...w }));
  const managerOfSquad = new Map<number, SeedWorker>();
  const reportCounts = new Map<string, number>();
  for (const w of next) {
    if (w.role === "manager" && w.squadIndex !== null) managerOfSquad.set(w.squadIndex, w);
    if (w.managerWorkerId) {
      reportCounts.set(w.managerWorkerId, (reportCounts.get(w.managerWorkerId) ?? 0) + 1);
    }
  }

  // 10 distinct active, seated squad members: 5 terminate, 4 change manager, 1 goes on leave.
  const picked = faker.helpers.arrayElements(
    next.filter((w) => w.role === "member" && w.status === "active" && w.holdsSeat),
    10,
  );
  for (const w of picked.slice(0, 5)) {
    w.status = "terminated";
    w.terminationDate = randomDate(faker, "2026-11-03", "2026-11-13");
  }
  for (const w of picked.slice(5, 9)) {
    // A new manager in the same group, with room on their team.
    const group = org.squads[w.squadIndex!].groupIndex;
    const candidates = [...managerOfSquad.values()].filter(
      (m) =>
        m.workerId !== w.managerWorkerId &&
        org.squads[m.squadIndex!].groupIndex === group &&
        (reportCounts.get(m.workerId) ?? 0) <= 12,
    );
    const newManager = faker.helpers.arrayElement(candidates).workerId;
    reportCounts.set(w.managerWorkerId!, (reportCounts.get(w.managerWorkerId!) ?? 0) - 1);
    reportCounts.set(newManager, (reportCounts.get(newManager) ?? 0) + 1);
    w.managerWorkerId = newManager;
  }
  picked[9].status = "leave";

  // Hires: each reports to a squad manager, gets the next worker and position numbers, and joins
  // the squad's group cost center. The last hire is a contingent worker.
  const maxNumber = Math.max(...next.map((w) => workerNumber(w.workerId)));
  const people = new PersonFactory(
    faker,
    maxNumber + 1,
    next.map((w) => w.email),
  );
  const hireSquads = faker.helpers.arrayElements(
    org.squads.map((_, i) => i),
    6,
  );
  hireSquads.forEach((squadIndex, i) => {
    const squad = org.squads[squadIndex];
    const contingent = i === hireSquads.length - 1;
    next.push(
      people.create({
        status: "active",
        terminationDate: null,
        workerType: contingent ? "contingent" : "employee",
        hireDate: randomDate(faker, "2026-11-02", "2026-11-13"),
        managerWorkerId: managerOfSquad.get(squadIndex)!.workerId,
        jobTitle: contingent
          ? "Contract Software Engineer"
          : faker.helpers.arrayElement(MEMBER_JOB_TITLES),
        supervisoryOrg: squad.name,
        costCenter: org.groups[squad.groupIndex].costCenter,
        role: "member",
        squadIndex,
        holdsSeat: false, // the report is HRIS-side: the leaders' plan hasn't seated them yet
      }),
    );
  });
  return next;
}

// Compares two report files (parsed rows, header first) and lists every difference as a
// documented change. Throws on any change that isn't one of the four kinds, so the change list
// in the README can't silently miss something.
export function diffReports(before: string[][], after: string[][]): ReportChange[] {
  const toMap = (rows: string[][]) => {
    const [header, ...body] = rows;
    return new Map(
      body.map((cells) => {
        const record: Record<string, string> = {};
        header.forEach((name, i) => (record[name] = cells[i].trim()));
        return [record.Employee_ID, record] as const;
      }),
    );
  };
  const a = toMap(before);
  const b = toMap(after);
  const changes: ReportChange[] = [];

  for (const [id, row] of b) {
    const old = a.get(id);
    if (!old) {
      changes.push({
        change: "hire",
        workerId: id,
        detail: `Hire_Date ${row.Hire_Date}; Position_ID ${row.Position_ID}; Manager_ID ${row.Manager_ID}`,
      });
      continue;
    }
    const changed = REPORT_COLUMNS.filter((c) => old[c] !== row[c]);
    if (changed.length === 0) continue;
    const key = changed.join(",");
    if (key === "Worker_Status,Termination_Date" && row.Worker_Status === "Terminated") {
      changes.push({
        change: "termination",
        workerId: id,
        detail: `Worker_Status ${old.Worker_Status} -> Terminated; Termination_Date ${row.Termination_Date}`,
      });
    } else if (key === "Manager_ID") {
      changes.push({
        change: "manager_change",
        workerId: id,
        detail: `Manager_ID ${old.Manager_ID} -> ${row.Manager_ID}`,
      });
    } else if (key === "Worker_Status" && row.Worker_Status === "On Leave") {
      changes.push({
        change: "leave",
        workerId: id,
        detail: `Worker_Status ${old.Worker_Status} -> On Leave`,
      });
    } else {
      throw new Error(`Unexpected change for ${id}: ${key}`);
    }
  }
  for (const id of a.keys()) {
    if (!b.has(id)) throw new Error(`Worker ${id} is missing from the later report`);
  }
  return changes.sort(
    (x, y) =>
      CHANGE_ORDER.indexOf(x.change) - CHANGE_ORDER.indexOf(y.change) ||
      x.workerId.localeCompare(y.workerId),
  );
}

export const reportFileName = (isoDate: string): string => `worker_report_${isoDate}.csv`;
