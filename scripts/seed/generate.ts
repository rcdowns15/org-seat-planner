import { Faker, en } from "@faker-js/faker";
import { NEXT_REPORT_SEED, SEED } from "./config";
import { buildOrg, type Org } from "./org";
import {
  buildHeadcountPlan,
  buildLeaders,
  buildSeats,
  type SeedLeader,
  type SeedPlanRow,
  type SeedSeat,
} from "./seats";
import { buildNextReportWorkers } from "./workday-reports";
import { buildWorkforce, type SeedWorker } from "./workers";

export type SeedData = {
  org: Org;
  workers: SeedWorker[]; // the seeded state, as of the 11-01 report
  nextReportWorkers: SeedWorker[]; // the 11-15 report's state
  seats: SeedSeat[];
  leaders: SeedLeader[];
  plan: SeedPlanRow[];
};

function newFaker(seed: number): Faker {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed);
  return faker;
}

// Pure and deterministic: no clock, no database, no global random state.
export function generateSeedData(): SeedData {
  const faker = newFaker(SEED);
  const org = buildOrg(faker);
  const workforce = buildWorkforce(org, faker);
  const seats = buildSeats(org, workforce, faker);
  const leaders = buildLeaders(org, workforce);
  const plan = buildHeadcountPlan(org, seats, faker);
  const nextReportWorkers = buildNextReportWorkers(
    org,
    workforce.workers,
    newFaker(NEXT_REPORT_SEED),
  );
  return { org, workers: workforce.workers, nextReportWorkers, seats, leaders, plan };
}
