// Fixed constants for the seed. "Today" is the date of the first Workday report, so the generator
// never reads the clock: the same code always produces the same data (D-014).

export const SEED = 20261101;
// A second, independent seed for the 11-15 report's changes, so tweaking them never reshuffles
// the 11-01 state.
export const NEXT_REPORT_SEED = 20261115;

export const SEED_DATE = "2026-11-01"; // the seeded state is "as of" this report
export const NEXT_REPORT_DATE = "2026-11-15";

// Headcount plan quarters: previous 2, current (Q4 2026) and next 2.
export const PLAN_QUARTER_STARTS = [
  "2026-04-01",
  "2026-07-01",
  "2026-10-01",
  "2027-01-01",
  "2027-04-01",
] as const;

export const SQUADS_PER_GROUP = 15;
// Filled seats per squad (including the squad's manager) are drawn from this range.
export const FILLED_SEATS_MIN = 8;
export const FILLED_SEATS_MAX = 14;
// Share of squad members who are contingent workers, in percent.
export const CONTINGENT_PERCENT = 10;
// Open + backfill seats: one per squad, plus this many extras on randomly chosen squads.
export const OPEN_EXTRA_SEATS = 20;
export const OFFER_ACCEPTED_SEATS = 15;
export const ON_LEAVE_WORKERS = 20;
export const TERMINATED_SEATED_WORKERS = 3;
export const TERMINATED_UNSEATED_WORKERS = 20;
