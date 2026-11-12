// Hand-written fictional names for the org. No faker company names, and nothing that resembles a
// real company, product or team (D-001, D-014). Person names come from faker, not from here.

export const DIVISION_NAMES = [
  "Retail Banking Technology",
  "Lending Technology",
  "Treasury and Payments Technology",
  "Enterprise Platform Technology",
] as const;

// Three groups per division, in division order.
export const GROUP_NAMES = [
  ["Digital Channels", "Accounts and Cards", "Customer Identity"],
  ["Loan Origination", "Credit Decisioning", "Loan Servicing"],
  ["Payments Hub", "Treasury Operations", "Cash Management"],
  ["Platform Engineering", "Data and Analytics", "Security Engineering"],
] as const;

// Squad names are "<Word> <Noun>", for example "Amber Ledger".
export const SQUAD_WORDS = [
  "Amber",
  "Cedar",
  "Harbor",
  "Summit",
  "Falcon",
  "Maple",
  "Granite",
  "Willow",
  "Copper",
  "Meadow",
  "Cobalt",
  "Juniper",
  "Lantern",
  "Prairie",
  "Quartz",
  "Ridge",
  "Saffron",
  "Timber",
  "Valley",
  "Birch",
  "Indigo",
  "Coral",
  "Aspen",
  "Onyx",
] as const;

export const SQUAD_NOUNS = [
  "Ledger",
  "Gateway",
  "Pipeline",
  "Vault",
  "Portal",
  "Engine",
  "Bridge",
  "Console",
  "Registry",
  "Scheduler",
  "Tracker",
  "Exchange",
  "Atlas",
  "Beacon",
  "Relay",
] as const;

export const MEMBER_JOB_TITLES = [
  "Software Engineer I",
  "Software Engineer II",
  "Senior Software Engineer",
  "Staff Engineer",
  "Data Engineer",
  "QA Engineer",
  "Site Reliability Engineer",
  "Product Analyst",
] as const;

export const CONTINGENT_JOB_TITLES = [
  "Contract Software Engineer",
  "Contract QA Engineer",
  "Contract Data Engineer",
] as const;

// Office cities plus Remote. No building or company names (D-029).
export const LOCATIONS = [
  "Charlotte",
  "Dallas",
  "Denver",
  "Chicago",
  "New York",
  "Remote",
] as const;

export const EMAIL_DOMAIN = "secondrepublicbank.example";
