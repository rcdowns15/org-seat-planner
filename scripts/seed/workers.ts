import type { Faker } from "@faker-js/faker";
import {
  AGED_OUT_LEAVERS,
  CONTINGENT_PERCENT,
  FILLED_SEATS_MAX,
  FILLED_SEATS_MIN,
  NEXT_REPORT_DATE,
  ON_LEAVE_WORKERS,
  SEED_DATE,
  TERMINATED_SEATED_WORKERS,
  TERMINATED_UNSEATED_WORKERS,
  TERMINATED_WINDOW_DAYS,
} from "./config";
import { dayNumber, fromDayNumber } from "./dates";
import {
  CONTINGENT_JOB_TITLES,
  EMAIL_DOMAIN,
  LOCATIONS,
  MEMBER_JOB_TITLES,
  SPECIAL_GIVEN_NAMES,
  SPECIAL_SURNAMES,
} from "./names";
import type { Org } from "./org";

export type WorkerRole = "top" | "division_leader" | "group_leader" | "manager" | "member";

// One person as Workday knows them, plus a little org context the generator needs. The first
// block of fields is written to workday.workers; contractEndDate is in the report CSV only
// (D-031); the rest never leaves the generator.
export type SeedWorker = {
  workerId: string;
  firstName: string;
  lastName: string;
  email: string;
  workerType: "employee" | "contingent";
  status: "active" | "leave" | "terminated";
  hireDate: string;
  terminationDate: string | null;
  managerWorkerId: string | null;
  jobTitle: string;
  supervisoryOrg: string;
  positionId: string;
  costCenter: string;
  location: string;
  // Report CSV only (D-031): set for contingent workers, null for employees.
  contractEndDate: string | null;
  // Generator-only context:
  personNumber: number; // 1, 2, 3, ... in creation order; drives ids and stray whitespace
  role: WorkerRole;
  // The supervisory organization this worker leads, if they manage anyone. Their direct reports
  // carry "<leadsOrg> (<this worker's full name>)" as their Supervisory_Organization.
  leadsOrg: string | null;
  squadIndex: number | null; // the squad they belong to (null for leaders above squad level)
  holdsSeat: boolean;
};

export type Workforce = {
  workers: SeedWorker[]; // in person number order
  topWorkerId: string;
  divisionLeaderIds: string[]; // by division index
  groupLeaderIds: string[]; // by group index
  // Per squad: the manager first, then the members, for every worker who holds a seat.
  rosters: string[][];
};

// Two Worker_ID schemes, as in many Workday tenants (D-031): employees get six digits (100001),
// contingent workers "C-" plus five digits (C-00042). Both come from the person number, so ids
// never collide. Position ids look like P-004001 (one per worker, D-029).
export const workerIdFor = (n: number, workerType: SeedWorker["workerType"]): string =>
  workerType === "employee" ? String(100_000 + n) : `C-${String(n).padStart(5, "0")}`;
export const positionIdFor = (n: number): string => `P-${String(4_000 + n).padStart(6, "0")}`;

export function randomDate(faker: Faker, from: string, to: string): string {
  return fromDayNumber(faker.number.int({ min: dayNumber(from), max: dayNumber(to) }));
}

// First day a terminated worker still appears in the report dated `reportDate`.
export const terminationWindowStart = (reportDate: string): string =>
  fromDayNumber(dayNumber(reportDate) - (TERMINATED_WINDOW_DAYS - 1));

// The population rule (D-031): Active and On Leave workers, plus Terminated workers whose
// termination date falls in the 30 days up to and including the report date.
export function inReportPopulation(w: SeedWorker, reportDate: string): boolean {
  if (w.status !== "terminated") return true;
  const date = w.terminationDate!;
  return date >= terminationWindowStart(reportDate) && date <= reportDate;
}

// Workday-style supervisory organization: "<org name> (<manager full name>)". It follows the
// manager tree: a worker sits in the org their manager leads. The top of the tree, who has no
// manager, sits in the org they lead. Squads are an app concept and never appear here.
export function assignSupervisoryOrgs(workers: SeedWorker[]): void {
  const byId = new Map(workers.map((w) => [w.workerId, w]));
  const orgOf = (leader: SeedWorker) =>
    `${leader.leadsOrg} (${leader.firstName} ${leader.lastName})`;
  for (const w of workers) {
    const manager = w.managerWorkerId ? byId.get(w.managerWorkerId)! : w;
    if (!manager.leadsOrg) throw new Error(`Manager ${manager.workerId} leads no org`);
    w.supervisoryOrg = orgOf(manager);
  }
}

// Every person number of this form gets a name from the special-character lists in names.ts.
const SPECIAL_NAME_EVERY = 125;
const SPECIAL_NAME_OFFSET = 17;

// For emails: drop accents (é -> e), then anything that isn't a lowercase letter.
const emailPart = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

// Creates people with unique ids, position ids and emails. Used by the 11-01 build and by the
// 11-15 hires.
export class PersonFactory {
  private next: number;
  private emails: Set<string>;

  constructor(
    private faker: Faker,
    startNumber: number,
    usedEmails: Iterable<string> = [],
  ) {
    this.next = startNumber;
    this.emails = new Set(usedEmails);
  }

  create(
    fields: Omit<
      SeedWorker,
      | "workerId"
      | "personNumber"
      | "positionId"
      | "firstName"
      | "lastName"
      | "email"
      | "location"
      | "contractEndDate"
      | "supervisoryOrg"
    >,
  ): SeedWorker {
    const n = this.next++;
    let firstName = this.faker.person.firstName();
    let lastName = this.faker.person.lastName();
    // A fixed, small set of people get a name with an apostrophe, accent or hyphen. Chosen by
    // person number, not by faker, so the random stream (and everyone else's name) is unchanged.
    if (n % SPECIAL_NAME_EVERY === SPECIAL_NAME_OFFSET) {
      const k = Math.floor(n / SPECIAL_NAME_EVERY);
      firstName = SPECIAL_GIVEN_NAMES[k % SPECIAL_GIVEN_NAMES.length];
      lastName = SPECIAL_SURNAMES[k % SPECIAL_SURNAMES.length];
    }
    const base = `${emailPart(firstName)}.${emailPart(lastName)}`;
    let email = `${base}@${EMAIL_DOMAIN}`;
    for (let i = 2; this.emails.has(email); i++) email = `${base}${i}@${EMAIL_DOMAIN}`;
    this.emails.add(email);
    const location = this.faker.helpers.arrayElement(LOCATIONS);
    // Contingent contracts end between 90 days after the hire (at the earliest Dec 2026) and the
    // end of 2027.
    const contractEndDate =
      fields.workerType === "contingent"
        ? randomDate(
            this.faker,
            fromDayNumber(Math.max(dayNumber("2026-12-01"), dayNumber(fields.hireDate) + 90)),
            "2027-12-31",
          )
        : null;
    return {
      ...fields,
      workerId: workerIdFor(n, fields.workerType),
      personNumber: n,
      positionId: positionIdFor(n),
      firstName,
      lastName,
      email,
      location,
      contractEndDate,
      supervisoryOrg: "", // filled in by assignSupervisoryOrgs once every manager exists
    };
  }
}

// Builds every worker as of the seed date: a management chain (head of engineering -> division
// leaders -> group leaders -> squad managers -> squad members), plus recent leavers who no longer
// hold seats. Everyone built here is in the 11-01 report population.
export function buildWorkforce(org: Org, faker: Faker): Workforce {
  const people = new PersonFactory(faker, 1);
  const workers: SeedWorker[] = [];
  const add = (w: SeedWorker): SeedWorker => {
    workers.push(w);
    return w;
  };
  const common = {
    status: "active" as const,
    terminationDate: null,
  };

  const top = add(
    people.create({
      ...common,
      workerType: "employee",
      hireDate: randomDate(faker, "2012-01-01", "2016-12-31"),
      managerWorkerId: null,
      jobTitle: "Head of Engineering",
      costCenter: org.groups[0].costCenter,
      role: "top",
      leadsOrg: "Engineering",
      squadIndex: null,
      holdsSeat: false,
    }),
  );

  const divisionLeaders = org.divisions.map((division, divisionIndex) =>
    add(
      people.create({
        ...common,
        workerType: "employee",
        hireDate: randomDate(faker, "2012-01-01", "2018-12-31"),
        managerWorkerId: top.workerId,
        jobTitle: "VP, Engineering",
        costCenter: org.groups.find((g) => g.divisionIndex === divisionIndex)!.costCenter,
        role: "division_leader",
        leadsOrg: division.name,
        squadIndex: null,
        holdsSeat: false,
      }),
    ),
  );

  const groupLeaders = org.groups.map((group) =>
    add(
      people.create({
        ...common,
        workerType: "employee",
        hireDate: randomDate(faker, "2013-01-01", "2020-12-31"),
        managerWorkerId: divisionLeaders[group.divisionIndex].workerId,
        jobTitle: "Director, Engineering",
        costCenter: group.costCenter,
        role: "group_leader",
        leadsOrg: group.name,
        squadIndex: null,
        holdsSeat: false,
      }),
    ),
  );

  // Squads: a manager and 7-13 members each. Each manager leads a Workday team named after the
  // group and a number ("Digital Channels Team 3"), not after the app's squad.
  const managers: SeedWorker[] = [];
  const memberLists: SeedWorker[][] = [];
  const rosters: string[][] = [];
  const teamsPerGroup = org.groups.map(() => 0);
  org.squads.forEach((squad, squadIndex) => {
    const group = org.groups[squad.groupIndex];
    const teamNumber = ++teamsPerGroup[squad.groupIndex];
    const manager = add(
      people.create({
        ...common,
        workerType: "employee",
        hireDate: randomDate(faker, "2014-01-01", "2023-12-31"),
        managerWorkerId: groupLeaders[squad.groupIndex].workerId,
        jobTitle: "Engineering Manager",
        costCenter: group.costCenter,
        role: "manager",
        leadsOrg: `${group.name} Team ${teamNumber}`,
        squadIndex,
        holdsSeat: true,
      }),
    );
    managers.push(manager);
    const memberCount = faker.number.int({ min: FILLED_SEATS_MIN, max: FILLED_SEATS_MAX }) - 1;
    const members: SeedWorker[] = [];
    for (let i = 0; i < memberCount; i++) {
      // The first member of squads 2 and 3 are the named demo fixtures (see README): keep them
      // employees so the fixtures are simple.
      const isFixture = i === 0 && (squadIndex === 2 || squadIndex === 3);
      const contingent = !isFixture && faker.number.int({ min: 1, max: 100 }) <= CONTINGENT_PERCENT;
      members.push(
        add(
          people.create({
            ...common,
            workerType: contingent ? "contingent" : "employee",
            hireDate: contingent
              ? randomDate(faker, "2025-01-01", "2026-09-30")
              : randomDate(faker, "2015-01-01", "2026-09-30"),
            managerWorkerId: manager.workerId,
            jobTitle: contingent
              ? faker.helpers.arrayElement(CONTINGENT_JOB_TITLES)
              : faker.helpers.arrayElement(MEMBER_JOB_TITLES),
            costCenter: group.costCenter,
            role: "member",
            leadsOrg: null,
            squadIndex,
            holdsSeat: true,
          }),
        ),
      );
    }
    memberLists.push(members);
    rosters.push([manager.workerId, ...members.map((m) => m.workerId)]);
  });

  // Seated workers whose HRIS status isn't "active". Both named fixtures come first, then random
  // others: a worker on leave keeps their seat; a terminated worker still holds theirs until a
  // leader releases it (a reconciliation exception, not a crash). Their termination dates
  // (10-20 to 10-31) keep them inside both the 11-01 and the 11-15 report windows.
  const leaveFixture = memberLists[2][0];
  const terminatedFixture = memberLists[3][0];
  const others = faker.helpers.arrayElements(
    memberLists.flat().filter((w) => w !== leaveFixture && w !== terminatedFixture),
    ON_LEAVE_WORKERS - 1 + TERMINATED_SEATED_WORKERS - 1,
  );
  leaveFixture.status = "leave";
  const terminatedSeated = [terminatedFixture, ...others.slice(ON_LEAVE_WORKERS - 1)];
  for (const w of others.slice(0, ON_LEAVE_WORKERS - 1)) w.status = "leave";
  for (const w of terminatedSeated) {
    w.status = "terminated";
    w.terminationDate = randomDate(faker, "2026-10-20", "2026-10-31");
  }

  // Recent leavers who already lost their seat; at most one per squad. All are inside the 11-01
  // report window (10-03 to 11-01). The first few left before 10-17, so they age out of the 11-15
  // report (window 10-17 to 11-15); the rest stay in it.
  const leaverSquads = faker.helpers.arrayElements(
    org.squads.map((_, i) => i),
    TERMINATED_UNSEATED_WORKERS,
  );
  const nextWindowStart = terminationWindowStart(NEXT_REPORT_DATE); // 2026-10-17
  leaverSquads.forEach((squadIndex, i) => {
    const squad = org.squads[squadIndex];
    const hireDate = randomDate(faker, "2016-01-01", "2026-06-30");
    const terminationDate =
      i < AGED_OUT_LEAVERS
        ? randomDate(
            faker,
            terminationWindowStart(SEED_DATE),
            fromDayNumber(dayNumber(nextWindowStart) - 1),
          )
        : randomDate(faker, nextWindowStart, SEED_DATE);
    add(
      people.create({
        status: "terminated",
        terminationDate,
        workerType: "employee",
        hireDate,
        managerWorkerId: managers[squadIndex].workerId,
        jobTitle: faker.helpers.arrayElement(MEMBER_JOB_TITLES),
        costCenter: org.groups[squad.groupIndex].costCenter,
        role: "member",
        leadsOrg: null,
        squadIndex,
        holdsSeat: false,
      }),
    );
  });

  assignSupervisoryOrgs(workers);
  return {
    workers,
    topWorkerId: top.workerId,
    divisionLeaderIds: divisionLeaders.map((w) => w.workerId),
    groupLeaderIds: groupLeaders.map((w) => w.workerId),
    rosters,
  };
}
