import type { Faker } from "@faker-js/faker";
import {
  CONTINGENT_PERCENT,
  OFFER_ACCEPTED_SEATS,
  OPEN_EXTRA_SEATS,
  PLAN_QUARTER_STARTS,
} from "./config";
import type { Org } from "./org";
import type { SeedWorker, Workforce } from "./workers";

export type SeedSeat = {
  squadIndex: number;
  seatType: "employee" | "contingent";
  status: "filled" | "open" | "backfill" | "offer_accepted";
  workerId: string | null;
};

export type SeedLeader = {
  workerId: string;
  displayName: string;
  scopeType: "division" | "group";
  divisionIndex: number | null;
  groupIndex: number | null;
};

export type SeedPlanRow = { squadIndex: number; quarterStart: string; approvedSeats: number };

// The first open seat of this squad is the "open seat outside the group leader's scope" fixture:
// squad 15 is the first squad of group 1, and the demo group leader leads group 0 (same division).
export const OUT_OF_SCOPE_SQUAD_INDEX = 15;

// Seats, squad by squad (the array index + 1 is the seat_id): a filled seat for each seated worker
// (including workers on leave and terminated workers who still hold one), then the squad's open
// and backfill seats, then any offer_accepted seat. Worker type decides the seat type.
export function buildSeats(org: Org, workforce: Workforce, faker: Faker): SeedSeat[] {
  const byId = new Map<string, SeedWorker>(workforce.workers.map((w) => [w.workerId, w]));

  // 1 open/backfill seat per squad, plus extras on randomly chosen squads.
  const openCounts = org.squads.map(() => 1);
  for (const i of faker.helpers.arrayElements(
    org.squads.map((_, i) => i),
    OPEN_EXTRA_SEATS,
  )) {
    openCounts[i]++;
  }
  const offerSquads = new Set(
    faker.helpers.arrayElements(
      org.squads.map((_, i) => i),
      OFFER_ACCEPTED_SEATS,
    ),
  );
  const randomType = (): SeedSeat["seatType"] =>
    faker.number.int({ min: 1, max: 100 }) <= CONTINGENT_PERCENT ? "contingent" : "employee";

  const seats: SeedSeat[] = [];
  org.squads.forEach((_, squadIndex) => {
    for (const workerId of workforce.rosters[squadIndex]) {
      seats.push({
        squadIndex,
        seatType: byId.get(workerId)!.workerType,
        status: "filled",
        workerId,
      });
    }
    for (let i = 0; i < openCounts[squadIndex]; i++) {
      const forcedOpen = squadIndex === OUT_OF_SCOPE_SQUAD_INDEX && i === 0;
      const status = forcedOpen || faker.datatype.boolean() ? "open" : "backfill";
      seats.push({ squadIndex, seatType: randomType(), status, workerId: null });
    }
    if (offerSquads.has(squadIndex)) {
      seats.push({
        squadIndex,
        seatType: randomType(),
        status: "offer_accepted",
        workerId: null,
      });
    }
  });
  return seats;
}

// One leader per division and per group: the division and group leaders from the workforce.
export function buildLeaders(org: Org, workforce: Workforce): SeedLeader[] {
  const byId = new Map<string, SeedWorker>(workforce.workers.map((w) => [w.workerId, w]));
  const name = (id: string) => `${byId.get(id)!.firstName} ${byId.get(id)!.lastName}`;
  return [
    ...org.divisions.map((_, divisionIndex): SeedLeader => {
      const workerId = workforce.divisionLeaderIds[divisionIndex];
      return {
        workerId,
        displayName: name(workerId),
        scopeType: "division",
        divisionIndex,
        groupIndex: null,
      };
    }),
    ...org.groups.map((_, groupIndex): SeedLeader => {
      const workerId = workforce.groupLeaderIds[groupIndex];
      return {
        workerId,
        displayName: name(workerId),
        scopeType: "group",
        divisionIndex: null,
        groupIndex,
      };
    }),
  ];
}

// Approved seats per squad for the previous 2, current and next 2 quarters. The current quarter
// matches the seats that exist; the other quarters drift by a seat or so.
export function buildHeadcountPlan(org: Org, seats: SeedSeat[], faker: Faker): SeedPlanRow[] {
  const seatCounts = org.squads.map(() => 0);
  for (const seat of seats) seatCounts[seat.squadIndex]++;

  const rows: SeedPlanRow[] = [];
  org.squads.forEach((_, squadIndex) => {
    const current = seatCounts[squadIndex];
    const q3 = Math.max(0, current - faker.number.int({ min: 0, max: 1 }));
    const q2 = Math.max(0, q3 - faker.number.int({ min: 0, max: 1 }));
    const next1 = current + faker.number.int({ min: 0, max: 1 });
    const next2 = next1 + faker.number.int({ min: 0, max: 1 });
    [q2, q3, current, next1, next2].forEach((approvedSeats, i) => {
      rows.push({ squadIndex, quarterStart: PLAN_QUARTER_STARTS[i], approvedSeats });
    });
  });
  return rows;
}
