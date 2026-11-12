# Seed generator

`pnpm db:seed` wipes and reseeds the `app` and `workday` schemas from a fixed faker seed, and writes
two mock Workday report CSVs to `data/workday/` (gitignored; regenerated every run).
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
match the 11-01 report; the 11-15 report is the next biweekly extract.

## Named demo fixtures

Tests and the demo script rely on these. Each is looked up by its key; `tests/db/seed.test.ts`
checks them against the database, and checks this table against the generated data.

| Fixture                    | Key                         | Value     | Notes                                                                                                                                                |
| -------------------------- | --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demo-division-leader`     | `app.leaders.worker_id`     | `W100002` | Savion Kshlerin, leads the division Retail Banking Technology.                                                                                       |
| `demo-group-leader`        | `app.leaders.worker_id`     | `W100006` | Anissa Predovic, leads the group Digital Channels (same division).                                                                                   |
| `out-of-scope-open-seat`   | `app.seats.seat_id`         | `198`     | An `open` employee seat in squad Saffron Scheduler, in the group Accounts and Cards: inside the division leader's scope, outside the group leader's. |
| `worker-on-leave`          | `workday.workers.worker_id` | `W100040` | Telly Boyle, status `leave`, keeps their seat (seat 26, squad Harbor Bridge).                                                                        |
| `terminated-seated-worker` | `workday.workers.worker_id` | `W100051` | Kaylie Parker, status `terminated` (2026-10-28), still holds seat 38 in squad Valley Portal.                                                         |

## Worker report layout

Modeled on a Workday worker custom report: one row per worker, one file per biweekly extract
(`worker_report_<YYYY-MM-DD>.csv`). Every report is a full extract. It is messy on purpose, so the
ingest (BR-03) and dbt staging have real cleaning to do: names are `Last, First`, dates are
`MM/DD/YYYY`, status and worker type are display text, and a few cells carry stray leading or
trailing whitespace. Files use UTF-8, a header row, comma separators, and `\n` line endings.

| #   | Column                     | Format                                         | Example                                      | Notes                                                                |
| --- | -------------------------- | ---------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| 1   | `Employee_ID`              | `W` + 6 digits                                 | `W100002`                                    | Worker id; becomes `workday.workers.worker_id`.                      |
| 2   | `Worker_Name`              | `Last, First` (quoted)                         | `"Kshlerin, Savion"`                         | Split into first and last name by staging.                           |
| 3   | `Work_Email`               | lowercase email                                | `savion.kshlerin@secondrepublicbank.example` |                                                                      |
| 4   | `Worker_Type`              | `Employee` or `Contingent Worker`              | `Employee`                                   |                                                                      |
| 5   | `Worker_Status`            | `Active`, `On Leave` or `Terminated`           | `Active`                                     |                                                                      |
| 6   | `Hire_Date`                | `MM/DD/YYYY`                                   | `08/16/2012`                                 |                                                                      |
| 7   | `Termination_Date`         | `MM/DD/YYYY`, empty unless terminated          | `10/28/2026`                                 |                                                                      |
| 8   | `Manager_ID`               | `Employee_ID` of the manager, empty at the top | `W100001`                                    |                                                                      |
| 9   | `Job_Title`                | text                                           | `VP, Engineering`                            |                                                                      |
| 10  | `Supervisory_Organization` | text                                           | `Retail Banking Technology`                  | The squad name for squad members.                                    |
| 11  | `Position_ID`              | `P-` + 6 digits                                | `P-004002`                                   | One per worker; a new hire gets a new one (D-029).                   |
| 12  | `Cost_Center`              | `CC-NNNN <group name>`                         | `CC-1010 Digital Channels`                   | One per group (D-029).                                               |
| 13  | `Location`                 | an office city or `Remote`                     | `Charlotte`                                  | One of Charlotte, Dallas, Denver, Chicago, New York, Remote (D-029). |

Sample (header and one full row, copied from the 11-01 report):

```csv
Employee_ID,Worker_Name,Work_Email,Worker_Type,Worker_Status,Hire_Date,Termination_Date,Manager_ID,Job_Title,Supervisory_Organization,Position_ID,Cost_Center,Location
W100002,"Kshlerin, Savion",savion.kshlerin@secondrepublicbank.example,Employee,Active,08/16/2012,,W100001,"VP, Engineering",Retail Banking Technology,P-004002,CC-1010 Digital Channels,Charlotte
```

Seats match Workday by worker id only. `Position_ID` is not linked to `app.seats` (D-029).

## Changes in the 11-15 report

The 11-15 report is the 11-01 state plus exactly these changes (compared after trimming stray
whitespace); `tests/db/seed.test.ts` diffs the two files and checks this list. It has 6 hires
(the last is contingent), 5 terminations of seated workers, 4 manager changes and 1 leave.
Seats in the app are not changed by the report: the hires, terminations and manager changes are
what a later ingest and reconciliation have to deal with.

| Change         | Employee_ID | Detail                                                          |
| -------------- | ----------- | --------------------------------------------------------------- |
| hire           | W102019     | Hire_Date 11/12/2026; Position_ID P-006019; Manager_ID W101866  |
| hire           | W102020     | Hire_Date 11/11/2026; Position_ID P-006020; Manager_ID W101407  |
| hire           | W102021     | Hire_Date 11/02/2026; Position_ID P-006021; Manager_ID W101049  |
| hire           | W102022     | Hire_Date 11/05/2026; Position_ID P-006022; Manager_ID W100719  |
| hire           | W102023     | Hire_Date 11/09/2026; Position_ID P-006023; Manager_ID W100561  |
| hire           | W102024     | Hire_Date 11/02/2026; Position_ID P-006024; Manager_ID W101933  |
| termination    | W100047     | Worker_Status Active -> Terminated; Termination_Date 11/08/2026 |
| termination    | W100879     | Worker_Status Active -> Terminated; Termination_Date 11/11/2026 |
| termination    | W101223     | Worker_Status Active -> Terminated; Termination_Date 11/07/2026 |
| termination    | W101360     | Worker_Status Active -> Terminated; Termination_Date 11/10/2026 |
| termination    | W101435     | Worker_Status Active -> Terminated; Termination_Date 11/13/2026 |
| manager_change | W100034     | Manager_ID W100027 -> W100093                                   |
| manager_change | W100327     | Manager_ID W100319 -> W100282                                   |
| manager_change | W100359     | Manager_ID W100355 -> W100491                                   |
| manager_change | W101277     | Manager_ID W101267 -> W101174                                   |
| leave          | W100874     | Worker_Status Active -> On Leave                                |

## How the reset works

The seed runs one transaction: `SET LOCAL app.allow_seat_changes_reset = 'on'`, `TRUNCATE` every
`app` and `workday` table with `RESTART IDENTITY`, then batched inserts. The setting is the escape
hatch in the `app.seat_changes` TRUNCATE guard (migration `0002`) and ends with the transaction.
The checksum covers every seeded row except columns the database fills with the clock.

## Files

- `config.ts` constants (seed, report dates, sizes); `dates.ts` date helpers; `names.ts` word lists.
- `org.ts` divisions, groups, squads; `workers.ts` people; `seats.ts` seats, leaders, plan.
- `workday-reports.ts` report columns, CSV rows, the 11-15 changes and the diff; `csv.ts` writer and parser.
- `generate.ts` pure generator; `run-seed.ts` database writes and report files; `checksum.ts`; `index.ts` CLI.
