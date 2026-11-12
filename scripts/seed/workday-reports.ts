import type { Faker } from "@faker-js/faker";
import { NEXT_REPORT_DATE, NEXT_REPORT_FUTURE_HIRES, NEXT_REPORT_HIRES } from "./config";
import { formatCsv } from "./csv";
import { dayNumber, fromDayNumber, fromUsDate, toUsDate } from "./dates";
import { MEMBER_JOB_TITLES } from "./names";
import type { Org } from "./org";
import type { SeedSeat } from "./seats";
import {
  PersonFactory,
  assignSupervisoryOrgs,
  inReportPopulation,
  randomDate,
  terminationWindowStart,
  type SeedWorker,
} from "./workers";

// The mock Workday "worker custom report". Column names are documented, in this order, in
// scripts/seed/README.md; a test keeps the two in sync.
export const REPORT_COLUMNS = [
  "Worker_ID",
  "Worker_Name",
  "Work_Email",
  "Worker_Type",
  "Worker_Status",
  "Hire_Date",
  "Termination_Date",
  "Contract_End_Date",
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
// worker type as display text. The person number decides which rows get stray whitespace, so the
// same worker is padded the same way in every report.
export function toReportRow(w: SeedWorker): string[] {
  const n = w.personNumber;
  return [
    w.workerId,
    `${w.lastName}, ${w.firstName}` + (n % 67 === 3 ? " " : ""),
    w.email,
    TYPE_TEXT[w.workerType],
    STATUS_TEXT[w.status],
    toUsDate(w.hireDate),
    w.terminationDate ? toUsDate(w.terminationDate) : "",
    w.contractEndDate ? toUsDate(w.contractEndDate) : "",
    w.managerWorkerId ?? "",
    w.jobTitle + (n % 41 === 7 ? "  " : ""),
    w.supervisoryOrg,
    w.positionId,
    w.costCenter,
    (n % 53 === 11 ? " " : "") + w.location,
  ];
}

// `workers` must already be the report's population (see inReportPopulation).
export function buildReportCsv(workers: SeedWorker[]): string {
  return formatCsv(REPORT_COLUMNS, workers.map(toReportRow));
}

export const CHANGE_KINDS = [
  "hire",
  "future_hire",
  "termination",
  "manager_change",
  "leave",
  "aged_out",
  "missing",
] as const;

export type ReportChange = {
  change: (typeof CHANGE_KINDS)[number];
  workerId: string;
  detail: string;
};

// Applies the 11-15 changes to the 11-01 state: 6 hires, 3 future-dated hires, 5 terminations of
// seated workers, 4 manager changes, 1 leave and 1 worker who goes missing with no termination.
// Then applies the population rule, which drops leavers terminated before 10-17 (aged out).
// Returns the 11-15 report population, in person number order (new people at the end).
export function buildNextReportWorkers(
  org: Org,
  workers: SeedWorker[],
  seats: SeedSeat[],
  faker: Faker,
): SeedWorker[] {
  let next = workers.map((w) => ({ ...w }));
  const managerOfSquad = new Map<number, SeedWorker>();
  const reportCounts = new Map<string, number>();
  const addReport = (managerId: string, delta: number) =>
    reportCounts.set(managerId, (reportCounts.get(managerId) ?? 0) + delta);
  for (const w of next) {
    if (w.role === "manager" && w.squadIndex !== null) managerOfSquad.set(w.squadIndex, w);
    if (w.managerWorkerId) addReport(w.managerWorkerId, 1);
  }

  // 11 distinct active, seated squad members: 5 terminate, 4 change manager, 1 goes on leave and
  // 1 goes missing from the report with no termination (the real "missing" exception).
  const picked = faker.helpers.arrayElements(
    next.filter((w) => w.role === "member" && w.status === "active" && w.holdsSeat),
    11,
  );
  for (const w of picked.slice(0, 5)) {
    w.status = "terminated";
    w.terminationDate = randomDate(faker, "2026-11-03", "2026-11-13");
  }
  for (const w of picked.slice(5, 9)) {
    // A new manager in the same group, with room on their team. The worker's supervisory org
    // follows the new manager (assignSupervisoryOrgs below).
    const group = org.squads[w.squadIndex!].groupIndex;
    const candidates = [...managerOfSquad.values()].filter(
      (m) =>
        m.workerId !== w.managerWorkerId &&
        org.squads[m.squadIndex!].groupIndex === group &&
        (reportCounts.get(m.workerId) ?? 0) <= 12,
    );
    const newManager = faker.helpers.arrayElement(candidates).workerId;
    addReport(w.managerWorkerId!, -1);
    addReport(newManager, 1);
    w.managerWorkerId = newManager;
  }
  picked[9].status = "leave";
  const missing = picked[10];
  addReport(missing.managerWorkerId!, -1);
  next = next.filter((w) => w !== missing);

  const people = new PersonFactory(
    faker,
    Math.max(...workers.map((w) => w.personNumber)) + 1,
    workers.map((w) => w.email),
  );

  // Hires who have started: each reports to a squad manager, gets the next worker and position
  // numbers, and joins the squad's group cost center. The last one is a contingent worker.
  const hireSquads = faker.helpers.arrayElements(
    org.squads.map((_, i) => i),
    NEXT_REPORT_HIRES,
  );
  hireSquads.forEach((squadIndex, i) => {
    const squad = org.squads[squadIndex];
    const contingent = i === hireSquads.length - 1;
    const manager = managerOfSquad.get(squadIndex)!;
    addReport(manager.workerId, 1);
    next.push(
      people.create({
        status: "active",
        terminationDate: null,
        workerType: contingent ? "contingent" : "employee",
        hireDate: randomDate(faker, "2026-11-02", "2026-11-13"),
        managerWorkerId: manager.workerId,
        jobTitle: contingent
          ? "Contract Software Engineer"
          : faker.helpers.arrayElement(MEMBER_JOB_TITLES),
        costCenter: org.groups[squad.groupIndex].costCenter,
        role: "member",
        leadsOrg: null,
        squadIndex,
        holdsSeat: false, // the report is HRIS-side: the leaders' plan hasn't seated them yet
      }),
    );
  });

  // Future-dated hires (start 1-60 days after the report, status Active), one per group, each in
  // a group that has a seeded offer_accepted seat: the hire behind that offer. The first group
  // picked has the most offer_accepted seats, so at least one group shows more offers than
  // future hires (the gap a group-level hiring check should surface). They hold no seat.
  const offerSeats = seats.filter((s) => s.status === "offer_accepted");
  const offersByGroup = new Map<number, SeedSeat[]>();
  for (const seat of offerSeats) {
    const group = org.squads[seat.squadIndex].groupIndex;
    offersByGroup.set(group, [...(offersByGroup.get(group) ?? []), seat]);
  }
  const groupsByOffers = [...offersByGroup.keys()].sort(
    (a, b) => offersByGroup.get(b)!.length - offersByGroup.get(a)!.length || a - b,
  );
  const [busiest, ...rest] = groupsByOffers;
  if (offersByGroup.get(busiest)!.length < 2) throw new Error("No group has 2+ offer seats");
  const futureGroups = [
    busiest,
    ...faker.helpers.arrayElements(rest, NEXT_REPORT_FUTURE_HIRES - 1),
  ];
  for (const group of futureGroups) {
    const seat = offersByGroup.get(group)![0];
    const manager = managerOfSquad.get(seat.squadIndex)!;
    addReport(manager.workerId, 1);
    next.push(
      people.create({
        status: "active",
        terminationDate: null,
        workerType: seat.seatType,
        hireDate: randomDate(
          faker,
          fromDayNumber(dayNumber(NEXT_REPORT_DATE) + 1),
          fromDayNumber(dayNumber(NEXT_REPORT_DATE) + 60),
        ),
        managerWorkerId: manager.workerId,
        jobTitle:
          seat.seatType === "contingent"
            ? "Contract Software Engineer"
            : faker.helpers.arrayElement(MEMBER_JOB_TITLES),
        costCenter: org.groups[group].costCenter,
        role: "member",
        leadsOrg: null,
        squadIndex: seat.squadIndex,
        holdsSeat: false,
      }),
    );
  }

  for (const [managerId, n] of reportCounts) {
    if (n > 15) throw new Error(`Manager ${managerId} would have ${n} direct reports`);
  }
  assignSupervisoryOrgs(next);
  return next.filter((w) => inReportPopulation(w, NEXT_REPORT_DATE));
}

// "Last, First" (possibly with stray whitespace) to "First Last".
const displayName = (workerName: string): string => {
  const [last, first] = workerName.split(",").map((s) => s.trim());
  return `${first} ${last}`;
};

// Compares two report files (parsed rows, header first) and lists every difference as a
// documented change. `afterDate` is the later report's date. Throws on any change that isn't one
// of the known kinds, so the change list in the README can't silently miss something.
export function diffReports(
  before: string[][],
  after: string[][],
  afterDate: string,
): ReportChange[] {
  const toMap = (rows: string[][]) => {
    const [header, ...body] = rows;
    return new Map(
      body.map((cells) => {
        const record: Record<string, string> = {};
        header.forEach((name, i) => (record[name] = cells[i].trim()));
        return [record.Worker_ID, record] as const;
      }),
    );
  };
  const a = toMap(before);
  const b = toMap(after);
  const changes: ReportChange[] = [];

  for (const [id, row] of b) {
    const old = a.get(id);
    if (!old) {
      const future = fromUsDate(row.Hire_Date) > afterDate;
      changes.push({
        change: future ? "future_hire" : "hire",
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
    } else if (key === "Manager_ID,Supervisory_Organization") {
      // The supervisory org must follow the new manager: "<org> (<new manager's name>)".
      const manager = b.get(row.Manager_ID);
      if (
        !manager ||
        !row.Supervisory_Organization.endsWith(` (${displayName(manager.Worker_Name)})`)
      ) {
        throw new Error(`Supervisory org for ${id} doesn't follow manager ${row.Manager_ID}`);
      }
      changes.push({
        change: "manager_change",
        workerId: id,
        detail: `Manager_ID ${old.Manager_ID} -> ${row.Manager_ID}; Supervisory_Organization ${old.Supervisory_Organization} -> ${row.Supervisory_Organization}`,
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
  const windowStart = terminationWindowStart(afterDate);
  for (const [id, old] of a) {
    if (b.has(id)) continue;
    const terminated = old.Worker_Status === "Terminated";
    if (terminated && fromUsDate(old.Termination_Date) < windowStart) {
      changes.push({
        change: "aged_out",
        workerId: id,
        detail: `Termination_Date ${old.Termination_Date}, before the window start ${toUsDate(windowStart)}`,
      });
    } else {
      changes.push({
        change: "missing",
        workerId: id,
        detail: `Worker_Status ${old.Worker_Status} in the earlier report; dropped with no termination`,
      });
    }
  }
  return changes.sort(
    (x, y) =>
      CHANGE_KINDS.indexOf(x.change) - CHANGE_KINDS.indexOf(y.change) ||
      x.workerId.localeCompare(y.workerId),
  );
}

export const reportFileName = (isoDate: string): string => `worker_report_${isoDate}.csv`;
