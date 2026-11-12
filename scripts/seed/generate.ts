import { Faker, en } from "@faker-js/faker";
import { NEXT_REPORT_SEED, SEED, SEED_DATE } from "./config";
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
import { buildWorkforce, inReportPopulation, type SeedWorker } from "./workers";

export type SeedData = {
  org: Org;
  workers: SeedWorker[]; // the seeded state: the 11-01 report population
  nextReportWorkers: SeedWorker[]; // the 11-15 report population
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
  // Everyone the workforce build creates is in the 11-01 population; fail loudly if not.
  const outside = workforce.workers.filter((w) => !inReportPopulation(w, SEED_DATE));
  if (outside.length > 0) throw new Error(`${outside[0].workerId} is outside the 11-01 report`);
  const seats = buildSeats(org, workforce, faker);
  const leaders = buildLeaders(org, workforce);
  const plan = buildHeadcountPlan(org, seats, faker);
  const nextReportWorkers = buildNextReportWorkers(
    org,
    workforce.workers,
    seats,
    newFaker(NEXT_REPORT_SEED),
  );
  return { org, workers: workforce.workers, nextReportWorkers, seats, leaders, plan };
}
