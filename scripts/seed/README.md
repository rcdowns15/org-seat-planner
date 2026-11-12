# Seed generator

`pnpm db:seed` wipes and reseeds the `app` and `workday` schemas from a fixed faker seed, and writes
two mock Workday report CSVs to `data/workday/` (gitignored; regenerated every run). It prints the target host and refuses a database that
isn't on `localhost` or `127.0.0.1` unless you pass `--allow-remote`.
`pnpm db:seed:check` prints a SHA-256 checksum of the rows now in the database. Running the seed
twice prints the same checksum, because nothing in the generator reads the clock or global
randomness (D-014).

## What it generates

Second Republic Bank (a fictional company, name only; D-001):

- 4 divisions, 12 groups, 180 squads. Names come from hand-written word lists in `names.ts`.
- About 2,000 workers (about 10% contingent), about 2,200 seats: one filled seat per seated worker,
  200 open or backfill seats, 15 `offer_accepted` seats.
- One leader per division and per group (16 in all).
- An approved headcount plan row per squad for each of the previous 2, current (Q4 2026) and next 2
  quarters.
- A management chain: head of engineering, division leaders, group leaders, squad managers, then
  squad members. Every manager has 3 to 15 direct reports.
- Some workers on leave (they keep their seat) and a few terminated workers who still hold a seat
  (a reconciliation exception, not a crash). Recent leavers without seats are in the report too.

"Today" in the generator is the first report date, 2026-11-01. The seeded `workday.workers` rows
match the 11-01 report exactly (every column except `Contract_End_Date`, which is CSV only); the
11-15 report is the next biweekly extract and is not loaded into the database by the seed.

## Named demo fixtures

Tests and the demo script rely on these. Each is looked up by its key; `tests/db/seed.test.ts`
checks them against the database, and checks this table against the generated data.

| Fixture                    | Key                         | Value    | Notes                                                                                                                                                |
| -------------------------- | --------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demo-division-leader`     | `app.leaders.worker_id`     | `100002` | Savion Kshlerin, leads the division Retail Banking Technology.                                                                                       |
| `demo-group-leader`        | `app.leaders.worker_id`     | `100006` | Anissa Predovic, leads the group Digital Channels (same division).                                                                                   |
| `out-of-scope-open-seat`   | `app.seats.seat_id`         | `206`    | An `open` employee seat in squad Saffron Scheduler, in the group Accounts and Cards: inside the division leader's scope, outside the group leader's. |
| `worker-on-leave`          | `workday.workers.worker_id` | `100042` | Adelle Rohan, status `leave`, keeps their seat (seat 28, squad Harbor Bridge).                                                                       |
| `terminated-seated-worker` | `workday.workers.worker_id` | `100052` | King Konopelski, status `terminated` (2026-10-28, inside both report windows), still holds seat 39 in squad Valley Portal.                           |

## Report population

Like a real filtered Workday worker report, each report holds every `Active` and `On Leave`
worker, plus `Terminated` workers whose termination date falls within the 30 days up to and
including the report date (report date minus 29 days through the report date). Workers terminated
before that window are left out. So a worker dropping off a later report is either legitimate
(**aged out**: terminated earlier, now outside the window) or an exception (**missing**: no
termination on record).

- 11-01 window: 10/03/2026 to 11/01/2026. Every seeded worker is inside it.
- 11-15 window: 10/17/2026 to 11/15/2026. Three leavers terminated before 10/17 age out of the
  11-15 report: `102005` (10/03), `102006` (10/11) and `102007` (10/15).
- One worker, `100878` (Sydney Bechtelar, `Active` on 11-01, seated in seat 955, squad Maple
  Bridge), is missing from the 11-15 report with no termination: the "missing worker" exception
  BR-03 reconciliation has to flag.
- The `terminated-seated-worker` fixture (terminated 10/28/2026) is inside both windows.

## Future-dated hires

The 11-15 report has 3 hires whose `Hire_Date` is 1 to 60 days after the report date, with status
`Active`. Each is the person behind a seeded `offer_accepted` seat in their group, and none holds a
seat in `app.seats`:

- `C-02031` (contingent, starts 12/22/2026) in Digital Channels, which has 2 `offer_accepted`
  seats: one more than its future hires, so a group-level hiring check shows a gap.
- `102032` (starts 11/19/2026) in Platform Engineering, which has 1 `offer_accepted` seat.
- `102033` (starts 11/24/2026) in Credit Decisioning, which has 2 `offer_accepted` seats (another
  gap).

They appear only in the 11-15 CSV. The seeded `workday.workers` is the 11-01 state, so it doesn't
contain them, and the plausibility rule "hire date on or before the report date" holds for every
seeded worker. In the 11-15 CSV that rule holds for everyone except these three.

## Worker report layout

Modeled on a Workday worker custom report: one row per worker in the report population (above),
one file per biweekly extract (`worker_report_<YYYY-MM-DD>.csv`). It is messy on purpose, so the
ingest (BR-03) and dbt staging have real cleaning to do: names are `Last, First`, dates are
`MM/DD/YYYY`, status and worker type are display text, and a few cells carry stray leading or
trailing whitespace. Files look like a typical export (D-031): UTF-8 **with a byte order mark**,
a header row, comma separators, **CRLF** line endings, and every field containing a comma quoted.
A few names carry an apostrophe, an accent or a hyphen (e.g. `"O'Halloran, Seán"`).

Squads exist only in the app. Workday knows supervisory organizations, which follow the manager
tree: a worker's `Supervisory_Organization` is the org their manager leads, shown as
`<org name> (<manager full name>)`, so a manager change moves the worker's supervisory org too.
Squad managers lead teams named `<group> Team <n>`; group leaders, division leaders and the head
of engineering lead orgs named after their group, division, and `Engineering`. The head of
engineering, who has no manager, sits in the org they lead.

| #   | Column                     | Format                                                | Example                                      | Notes                                                                     |
| --- | -------------------------- | ----------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | `Worker_ID`                | employees 6 digits; contingent `C-` + 5 digits        | `100002`                                     | `C-00021` for a contingent worker. Becomes `worker_id` everywhere.        |
| 2   | `Worker_Name`              | `Last, First` (quoted)                                | `"Kshlerin, Savion"`                         | Split into first and last name by staging. May contain `'`, `-`, accents. |
| 3   | `Work_Email`               | lowercase email                                       | `savion.kshlerin@secondrepublicbank.example` | Accents and punctuation dropped.                                          |
| 4   | `Worker_Type`              | `Employee` or `Contingent Worker`                     | `Employee`                                   |                                                                           |
| 5   | `Worker_Status`            | `Active`, `On Leave` or `Terminated`                  | `Active`                                     |                                                                           |
| 6   | `Hire_Date`                | `MM/DD/YYYY`                                          | `08/16/2012`                                 | Can be in the future for a future-dated hire.                             |
| 7   | `Termination_Date`         | `MM/DD/YYYY`, empty unless terminated                 | `10/28/2026`                                 |                                                                           |
| 8   | `Contract_End_Date`        | `MM/DD/YYYY`, set for contingent, empty for employees | `12/11/2027`                                 | CSV only: no `workday.workers` column yet (D-031).                        |
| 9   | `Manager_ID`               | `Worker_ID` of the manager, empty at the top          | `100001`                                     |                                                                           |
| 10  | `Job_Title`                | text                                                  | `VP, Engineering`                            |                                                                           |
| 11  | `Supervisory_Organization` | `<org name> (<manager full name>)`                    | `Engineering (Julianne Legros)`              | Follows the manager tree, not squads (D-031).                             |
| 12  | `Position_ID`              | `P-` + 6 digits                                       | `P-004002`                                   | One per worker; a new hire gets a new one (D-029).                        |
| 13  | `Cost_Center`              | `CC-NNNN <group name>`                                | `CC-1010 Digital Channels`                   | One per group (D-029).                                                    |
| 14  | `Location`                 | an office city or `Remote`                            | `Charlotte`                                  | One of Charlotte, Dallas, Denver, Chicago, New York, Remote (D-029).      |

Sample (header, one employee row and one contingent row, copied from the 11-01 report; the file
itself starts with a BOM and ends lines with CRLF):

```csv
Worker_ID,Worker_Name,Work_Email,Worker_Type,Worker_Status,Hire_Date,Termination_Date,Contract_End_Date,Manager_ID,Job_Title,Supervisory_Organization,Position_ID,Cost_Center,Location
100002,"Kshlerin, Savion",savion.kshlerin@secondrepublicbank.example,Employee,Active,08/16/2012,,,100001,"VP, Engineering",Engineering (Julianne Legros),P-004002,CC-1010 Digital Channels,Charlotte
C-00021,"Okuneva, Glenn",glenn.okuneva@secondrepublicbank.example,Contingent Worker,Active,04/16/2025,,12/11/2027,100018,Contract Data Engineer,Digital Channels Team 1 (Porter Hansen),P-004021,CC-1010 Digital Channels,Remote
```

Seats match Workday by worker id only. `Position_ID` is not linked to `app.seats` (D-029).

## Changes in the 11-15 report

The 11-15 report is the 11-01 report plus exactly these changes (compared by `Worker_ID` after
trimming stray whitespace); `tests/unit/seed-generator.test.ts` diffs the two files and checks
this list, and any difference not listed fails it. Kinds: `hire` (a new worker who has started),
`future_hire` (a new worker whose `Hire_Date` is after 11/15), `termination`, `manager_change`
(`Manager_ID` and `Supervisory_Organization` change together), `leave`, `aged_out` (terminated
before the 11-15 window, so legitimately dropped) and `missing` (dropped with no termination: an
exception). This report has 6 hires (the last is contingent), 3 future hires, 5 terminations of
seated workers, 4 manager changes, 1 leave, 3 aged out and 1 missing. Seats in the app are not
changed by the report: these are what a later ingest and reconciliation have to deal with.

| Change         | Worker_ID | Detail                                                                                                                                                     |
| -------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hire           | 102025    | Hire_Date 11/12/2026; Position_ID P-006025; Manager_ID 101697                                                                                              |
| hire           | 102026    | Hire_Date 11/04/2026; Position_ID P-006026; Manager_ID 101889                                                                                              |
| hire           | 102027    | Hire_Date 11/10/2026; Position_ID P-006027; Manager_ID 101423                                                                                              |
| hire           | 102028    | Hire_Date 11/04/2026; Position_ID P-006028; Manager_ID 101056                                                                                              |
| hire           | 102029    | Hire_Date 11/09/2026; Position_ID P-006029; Manager_ID 100732                                                                                              |
| hire           | C-02030   | Hire_Date 11/04/2026; Position_ID P-006030; Manager_ID 100566                                                                                              |
| future_hire    | 102032    | Hire_Date 11/19/2026; Position_ID P-006032; Manager_ID 101623                                                                                              |
| future_hire    | 102033    | Hire_Date 11/24/2026; Position_ID P-006033; Manager_ID 100795                                                                                              |
| future_hire    | C-02031   | Hire_Date 12/22/2026; Position_ID P-006031; Manager_ID 100018                                                                                              |
| termination    | 100047    | Worker_Status Active -> Terminated; Termination_Date 11/10/2026                                                                                            |
| termination    | 100883    | Worker_Status Active -> Terminated; Termination_Date 11/13/2026                                                                                            |
| termination    | 101365    | Worker_Status Active -> Terminated; Termination_Date 11/03/2026                                                                                            |
| termination    | 101441    | Worker_Status Active -> Terminated; Termination_Date 11/07/2026                                                                                            |
| termination    | 101600    | Worker_Status Active -> Terminated; Termination_Date 11/08/2026                                                                                            |
| manager_change | 100034    | Manager_ID 100027 -> 100173; Supervisory_Organization Digital Channels Team 2 (Hoyt Beatty-McDermott) -> Digital Channels Team 14 (Clotilde Goodwin-Adams) |
| manager_change | 100330    | Manager_ID 100322 -> 100352; Supervisory_Organization Accounts and Cards Team 12 (Ansley Wilkinson) -> Accounts and Cards Team 15 (Jacklyn Kuhic)          |
| manager_change | 101230    | Manager_ID 101226 -> 101264; Supervisory_Organization Treasury Operations Team 6 (Don Herzog) -> Treasury Operations Team 9 (Trisha Lang)                  |
| manager_change | 101283    | Manager_ID 101277 -> 101239; Supervisory_Organization Treasury Operations Team 10 (Wesley Runolfsson) -> Treasury Operations Team 7 (Francesca Cummings)   |
| leave          | 100363    | Worker_Status Active -> On Leave                                                                                                                           |
| aged_out       | 102005    | Termination_Date 10/03/2026, before the window start 10/17/2026                                                                                            |
| aged_out       | 102006    | Termination_Date 10/11/2026, before the window start 10/17/2026                                                                                            |
| aged_out       | 102007    | Termination_Date 10/15/2026, before the window start 10/17/2026                                                                                            |
| missing        | 100878    | Worker_Status Active in the earlier report; dropped with no termination                                                                                    |

## How the reset works

The seed runs one transaction: `SET LOCAL app.allow_seat_changes_reset = 'on'`, `TRUNCATE` every
`app` and `workday` table with `RESTART IDENTITY`, then batched inserts. The setting is the escape
hatch in the `app.seat_changes` TRUNCATE guard (migration `0002`) and ends with the transaction.
The checksum covers every seeded row except columns the database fills with the clock.

## Known simplifications

- **Leaders sit in a squad group's cost center** (D-032). The head of engineering and the division
  VPs are charged to a group's cost center (for example `CC-1010 Digital Channels`). A real org
  would give leaders a leadership cost center (for example `CC-1000 Engineering Leadership`).
  Parked: changing it would change the seed checksum and both report hashes, so it's raised again
  after the interview.

## Files

- `config.ts` constants (seed, report dates, sizes, the 30-day window); `dates.ts` date helpers;
  `names.ts` word lists, including the special-character names.
- `org.ts` divisions, groups, squads; `workers.ts` people, worker ids, the population rule and
  supervisory orgs; `seats.ts` seats, leaders, plan.
- `workday-reports.ts` report columns, CSV rows, the 11-15 changes and the diff; `csv.ts` writer
  (BOM, CRLF, quoting) and parser.
- `generate.ts` pure generator; `run-seed.ts` database writes and report files; `checksum.ts`; `index.ts` CLI.
