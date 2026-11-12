import type { Faker } from "@faker-js/faker";
import {
  CONTINGENT_PERCENT,
  FILLED_SEATS_MAX,
  FILLED_SEATS_MIN,
  ON_LEAVE_WORKERS,
  SEED_DATE,
  TERMINATED_SEATED_WORKERS,
  TERMINATED_UNSEATED_WORKERS,
} from "./config";
import { dayNumber, fromDayNumber } from "./dates";
import { CONTINGENT_JOB_TITLES, EMAIL_DOMAIN, LOCATIONS, MEMBER_JOB_TITLES } from "./names";
import type { Org } from "./org";

export type WorkerRole = "top" | "division_leader" | "group_leader" | "manager" | "member";

// One person as Workday knows them, plus a little org context the generator needs. Only the
// first block of fields is written to workday.workers; the rest never leaves the generator.
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
  // Generator-only context:
  role: WorkerRole;
  squadIndex: number | null; // the squad they belong to (null for leaders above squad level)
  holdsSeat: boolean;
};

export type Workforce = {
  workers: SeedWorker[]; // in worker id order
  topWorkerId: string;
  divisionLeaderIds: string[]; // by division index
  groupLeaderIds: string[]; // by group index
  // Per squad: the manager first, then the members, for every worker who holds a seat.
  rosters: string[][];
};

// Worker ids look like W100001; position ids like P-004001 (one per worker, D-029).
export const workerIdFor = (n: number): string => `W${100_000 + n}`;
export const positionIdFor = (n: number): string => `P-${String(4_000 + n).padStart(6, "0")}`;
export const workerNumber = (workerId: string): number => Number(workerId.slice(1)) - 100_000;

export function randomDate(faker: Faker, from: string, to: string): string {
  return fromDayNumber(faker.number.int({ min: dayNumber(from), max: dayNumber(to) }));
}

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
      "workerId" | "positionId" | "firstName" | "lastName" | "email" | "location"
    >,
  ): SeedWorker {
    const n = this.next++;
    const firstName = this.faker.person.firstName();
    const lastName = this.faker.person.lastName();
    const base = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, "");
    let email = `${base}@${EMAIL_DOMAIN}`;
    for (let i = 2; this.emails.has(email); i++) email = `${base}${i}@${EMAIL_DOMAIN}`;
    this.emails.add(email);
    return {
      ...fields,
      workerId: workerIdFor(n),
      positionId: positionIdFor(n),
      firstName,
      lastName,
      email,
      location: this.faker.helpers.arrayElement(LOCATIONS),
    };
  }
}

// Builds every worker as of the seed date: a management chain (head of engineering -> division
// leaders -> group leaders -> squad managers -> squad members), plus recent leavers who no longer
// hold seats.
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
      supervisoryOrg: "Engineering",
      costCenter: org.groups[0].costCenter,
      role: "top",
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
        supervisoryOrg: division.name,
        costCenter: org.groups.find((g) => g.divisionIndex === divisionIndex)!.costCenter,
        role: "division_leader",
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
        supervisoryOrg: group.name,
        costCenter: group.costCenter,
        role: "group_leader",
        squadIndex: null,
        holdsSeat: false,
      }),
    ),
  );

  // Squads: a manager and 7-13 members each.
  const managers: SeedWorker[] = [];
  const memberLists: SeedWorker[][] = [];
  const rosters: string[][] = [];
  org.squads.forEach((squad, squadIndex) => {
    const group = org.groups[squad.groupIndex];
    const manager = add(
      people.create({
        ...common,
        workerType: "employee",
        hireDate: randomDate(faker, "2014-01-01", "2023-12-31"),
        managerWorkerId: groupLeaders[squad.groupIndex].workerId,
        jobTitle: "Engineering Manager",
        supervisoryOrg: squad.name,
        costCenter: group.costCenter,
        role: "manager",
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
            supervisoryOrg: squad.name,
            costCenter: group.costCenter,
            role: "member",
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
  // leader releases it (a reconciliation exception, not a crash).
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

  // Recent leavers (last two months) who already lost their seat; at most one per squad.
  const leaverSquads = faker.helpers.arrayElements(
    org.squads.map((_, i) => i),
    TERMINATED_UNSEATED_WORKERS,
  );
  for (const squadIndex of leaverSquads) {
    const squad = org.squads[squadIndex];
    const hireDate = randomDate(faker, "2016-01-01", "2026-06-30");
    add(
      people.create({
        status: "terminated",
        terminationDate: randomDate(faker, "2026-09-01", SEED_DATE),
        workerType: "employee",
        hireDate,
        managerWorkerId: managers[squadIndex].workerId,
        jobTitle: faker.helpers.arrayElement(MEMBER_JOB_TITLES),
        supervisoryOrg: squad.name,
        costCenter: org.groups[squad.groupIndex].costCenter,
        role: "member",
        squadIndex,
        holdsSeat: false,
      }),
    );
  }

  return {
    workers,
    topWorkerId: top.workerId,
    divisionLeaderIds: divisionLeaders.map((w) => w.workerId),
    groupLeaderIds: groupLeaders.map((w) => w.workerId),
    rosters,
  };
}
