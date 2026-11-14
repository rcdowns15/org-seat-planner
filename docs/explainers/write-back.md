# Write-back: how a move gets from a drag to the database

This explainer walks through the write path of the seat planner: a leader moves a worker from one
seat to another, and the app validates it, writes it under an optimistic lock, and records it in an
append-only audit log. Code is cited as `path:line`; `pnpm docs:check` fails CI if a cited file or
line stops existing, so the numbers stay honest. (They can still drift to a nearby line if code is
inserted above them; when in doubt, open the file.)

## Read these first

Read them in this order. If you can explain these eight spots, you can explain the write path.

1. `src/lib/schemas/move.ts:11`: the move input. No leader field, two seat versions, and the
   list of failure codes at `src/lib/schemas/move.ts:28`. The list follows the check order except
   for `CONFLICT`, which sits once at the end but is checked twice (right after `FORBIDDEN`, and
   again at write); see section 3.
2. `src/server/actions/run-mutation.ts:14`: the front half of every mutation: Zod parse, then the
   acting leader from the cookie, never from input.
3. `src/server/services/permissions.ts:48`: `requireEditSquads`, permission on every squad a
   mutation touches.
4. `src/server/services/moves.ts:58`: `moveWorker`, the check order in the comment above it, and
   the one transaction.
5. `src/server/services/moves.ts:129`: the early `CONFLICT` check (D-037 part 2), and why it comes
   right after `FORBIDDEN`.
6. `src/server/services/moves.ts:191`: the version-checked `UPDATE ... WHERE seat_id AND version`,
   the optimistic lock itself (D-011).
7. `src/server/services/moves.ts:217`: two audit rows sharing one `move_id`, in the same
   transaction (D-010).
8. `db/migrations/0002_seat_changes_append_only.sql:5`: the trigger that makes `app.seat_changes`
   append-only, and its one escape hatch at
   `db/migrations/0002_seat_changes_append_only.sql:22`.

## 1. The life of a move

### In the browser

1. The board page is a server component. It reads the acting leader, loads the board, and passes
   the move server action down as a prop (`src/app/board/page.tsx:94`). Client code never imports
   `src/server/`; it only receives functions the server hands it. A unit test checks that rule
   (`tests/unit/client-boundary.test.ts:18`).
2. Every seat on the board carries its `version`, read straight from `app.seats`
   (`src/server/queries/board.ts:47`).
3. A filled card is draggable and an open or backfill card is droppable
   (`src/components/board/seat-card.tsx:58`). The keyboard path is the "Move to…" button
   (`src/components/board/seat-card.tsx:133`); both open the same dialog.
4. Dropping a card does not save anything. `onDragEnd` only opens the move dialog
   (`src/components/board/board-view.tsx:128`).
5. When the dialog opens, the board snapshots the seat versions it is showing
   (`src/components/board/board-view.tsx:96`). This snapshot matters: if another leader saves the
   same seat while the dialog is open, the save must send the old versions so the server can see
   the board was stale.
6. The leader picks an effective date and clicks Save. `save()` calls the server action with the
   worker, both seat ids, the date, and both loaded versions
   (`src/components/board/move-dialog.tsx:71`, versions at
   `src/components/board/move-dialog.tsx:81`).
7. On failure the dialog shows the server's message. On `CONFLICT` it also offers a Refresh button
   that reloads the board and its versions (`src/components/board/move-dialog.tsx:165`).

### On the server

8. `moveWorkerFromBoard` (`src/server/actions/board-move.ts:10`) is the action the board calls. It
   calls the plain move action and, if the move saved, revalidates `/board` so the page re-renders
   with the new state (`src/server/actions/board-move.ts:13`). It's a separate wrapper because
   `revalidatePath` only works inside a Next request and the database tests call the inner action
   directly.
9. `moveWorkerAction` (`src/server/actions/move.ts:10`) hands the schema, the raw input and the
   service to `runMutation` (`src/server/actions/move.ts:12`). The `"use server"` directive is on
   the function, not the file, so only marked functions become endpoints.
10. `runMutation` parses with Zod (`src/server/actions/run-mutation.ts:19`) and reads the acting
    leader from the cookie (`src/server/actions/run-mutation.ts:23`). No valid leader means
    `READ_ONLY` (`src/server/actions/run-mutation.ts:25`).
11. `moveWorker` (`src/server/services/moves.ts:58`) parses again and checks for a leader again
    (`src/server/services/moves.ts:63`). That's on purpose: the service is a public function that
    tests and future callers can reach without the action, so it doesn't trust its caller.
12. It opens one transaction (`src/server/services/moves.ts:80`) and runs `runMove` inside it
    (`src/server/services/moves.ts:97`). Every check and every write happens in there.
13. Expected failures are thrown as `MoveAborted` inside the transaction
    (`src/server/services/moves.ts:27`, thrown by `fail` at `src/server/services/moves.ts:33`).
    Throwing makes Drizzle roll the transaction back; the catch at
    `src/server/services/moves.ts:81` turns it back into a typed result value. Anything else (the
    database is down) is rethrown as a real error. Callers only ever see
    `{ ok: true, ... } | { ok: false, code, message }` (`src/lib/results.ts:2`).
14. On success: two version-checked `UPDATE`s (source seat, then target), two audit `INSERT`s, and
    the result carries the seats' new versions so the client could keep editing without a reload
    (`src/server/services/moves.ts:244`).
15. Every statement the move sent is recorded, with bound values, for the "Under the hood" SQL
    panel (`src/server/services/moves.ts:85`).

## 2. The acting leader and the permission check

**Mock auth (D-013).** There is no login. A dropdown in the header sets an `acting_leader_id`
cookie through the `setActingLeader` server action (`src/server/actions/acting-as.ts:13`). The
cookie is `httpOnly`, `sameSite: lax`, and `secure` in production
(`src/server/actions/acting-as.ts:27`), and is only ever set to the id of a leader that exists.

**The rule that matters:** the leader always comes from the server-side cookie, never from the
action's input. `getActingLeader` (`src/server/auth/acting-leader.ts:41`) reads the cookie,
accepts only a plain positive integer (`src/server/auth/acting-leader.ts:10`), and looks it up in
`app.leaders`. Anything unknown or malformed is `null`, which means read-only. The move schema has
no leader field, and Zod drops unknown keys, so a spoofed `leaderId` in the request body is thrown
away before the service sees it (`tests/unit/move-schema.test.ts:19`, and end to end in the DB test
"ignores a spoofed leader id: the group leader's cookie is FORBIDDEN outside their group").

**Scopes (D-013, D-030).** A leader is scoped to a division or a group. `scopeAllows`
(`src/server/services/permissions.ts:19`) is a pure function: a division leader edits every squad
whose group is in their division; a group leader edits only their group's squads.

**Both squads.** A move touches two squads: the one it leaves and the one it joins.
`requireEditSquads` (`src/server/services/permissions.ts:48`) needs permission on every squad in
the list, looks each one up through the caller's transaction, and fails closed on an empty list or
an unknown squad (`src/server/services/permissions.ts:62`; an unknown squad id finds no row, so
`canEditSquad`'s `rows.length === 1` at `src/server/services/permissions.ts:43` is false). The
move service passes both squad ids (`src/server/services/moves.ts:121`). An unknown seat id has no
squad to authorize against, so it is also `FORBIDDEN` (`src/server/services/moves.ts:120`) rather
than a "not found" that would let someone probe which seat ids exist.

The UI hides "Move to…" from a leader who can edit nothing (`src/app/board/page.tsx:42`), but that
is convenience only. The server still rejects their move (DB test "the server still rejects their
move with FORBIDDEN, writing nothing").

## 3. Every validation, in order

The service returns the first check that fails, in this order (the comment at
`src/server/services/moves.ts:42` lists it too):

| # | Code | Where | Why it exists |
|---|---|---|---|
| 1 | `INVALID_INPUT` | Zod, `src/server/actions/run-mutation.ts:19` and `src/server/services/moves.ts:64` | Shape at the trust boundary: integer ids in Postgres range, non-negative versions, a real `YYYY-MM-DD` date, a worker id of letters, digits and hyphens. |
| 2 | `READ_ONLY` | `src/server/actions/run-mutation.ts:25`, `src/server/services/moves.ts:67` | No acting leader selected. Viewing is allowed; editing needs a leader. |
| 3 | `FORBIDDEN` | `src/server/services/moves.ts:120` and `src/server/services/moves.ts:122` | The leader must be allowed to edit both squads (D-013). Unknown seats fail closed. |
| 4 | `CONFLICT` (early) | `src/server/services/moves.ts:129` | The seats must still be at the versions the leader loaded (D-037 part 2). |
| 5 | `WORKER_NOT_ACTIVE` | `src/server/services/moves.ts:139` | Workday is the source of truth for status. Only `active` workers move; a worker on leave keeps their seat; a terminated worker still in a seat is a reconciliation exception, not something to move. A worker missing from Workday isn't known to be active either. |
| 6 | `NOT_IN_SEAT` | `src/server/services/moves.ts:145` | The worker must hold the source seat. Without it you could "move" someone from a seat they don't hold while they sit elsewhere: double-seating. |
| 7 | `SEAT_NOT_AVAILABLE` | `src/server/services/moves.ts:151` and `src/server/services/moves.ts:154` | Only `open` and `backfill` seats receive a move; `offer_accepted` is reserved for an incoming hire. Moving a worker to the seat they already hold also lands here. |
| 8 | `SEAT_TYPE_MISMATCH` | `src/server/services/moves.ts:159` | Employees fill employee seats; contingent workers fill contingent seats. |
| 9 | `INVALID_EFFECTIVE_DATE` | `src/server/services/moves.ts:165` | Today through today + 90 days, UTC calendar dates, no backdating (D-012). The window lives in the service, not the schema, because it depends on the clock. |
| 10 | `EFFECTIVE_DATE_BEFORE_PENDING_CHANGE` | `src/server/services/moves.ts:182` | The date can't be earlier than the latest change already recorded for the worker, the source seat or the target seat (D-037, D-038). Equal is allowed. |
| 11 | `CONFLICT` (at write) | `src/server/services/moves.ts:202` and `src/server/services/moves.ts:215` | The version-checked `UPDATE` matched zero rows: someone changed the seat after this move read it. |

**Why `CONFLICT` is checked right after `FORBIDDEN` (D-037 part 2).** The domain checks (5 to 10)
read the seat rows. The `UPDATE`s only lock on the versions the client sent. If those two disagree,
the checks could validate one state of the seat and the write could land on another. A concrete
case from the review: a client forges a version one ahead of the row; the checks pass on the old
row; a racing move bumps the version; now the forged version matches and the `UPDATE` succeeds on a
seat nobody validated. Checking versions first means the domain checks run on exactly the rows the
writes will touch. The cost is small: a leader with a stale board and a bad date sees "refresh"
before the date error.

**Why `FORBIDDEN` comes before `CONFLICT`.** A leader without permission learns nothing about a
seat, not even that it changed.

**Why the date rule (D-037, D-038).** dbt rebuilds seat state as of each report date by ordering
changes by `(effective_date, change_id)`. That's only correct if no writer backdates. Without the
rule, a move dated before a pending move could put one worker in two seats on some date in history.
`latestEffectiveDates` finds the latest date per subject in one parameterized query
(`src/server/services/moves.ts:256`); it matches the worker on `worker_id`, `from_worker_id` and
`to_worker_id`, so a writer that only fills the from/to columns is still caught.

### Every move failure code and the test that covers it

The `tests/db/moves.test.ts` tests below run the real service against Postgres, and most of the
failure tests use `expectNothingWritten` to check that a failure writes nothing (no seat change, no
audit row). The exceptions: "'today' is the UTC calendar date of the injected clock" and "returns
READ_ONLY without a valid cookie, and INVALID_INPUT for bad input" check only the returned code;
"accepts %s" and "allows the same effective date as the latest pending change" are success tests;
and the race test checks by hand that the loser's source seat is unchanged and only the winner's two
audit rows were added.

| Code | Test (file: test name) |
|---|---|
| `INVALID_INPUT` | `tests/db/moves.test.ts`: "INVALID_INPUT: input that fails the Zod schema"; shape cases in `tests/unit/move-schema.test.ts`: "rejects %s" (16 cases) |
| `READ_ONLY` | `tests/db/moves.test.ts`: "READ_ONLY: no acting leader"; "returns READ_ONLY without a valid cookie, and INVALID_INPUT for bad input" (through the action and cookie) |
| `FORBIDDEN` | `tests/db/moves.test.ts`: "FORBIDDEN: the group leader can't move into a squad outside their group"; "FORBIDDEN: the group leader can't move someone out of a squad outside their group"; "FORBIDDEN: an unknown seat fails closed" |
| `WORKER_NOT_ACTIVE` | `tests/db/moves.test.ts`: "WORKER_NOT_ACTIVE: a worker on leave keeps their seat and can't be moved"; "WORKER_NOT_ACTIVE: a terminated worker who still holds a seat can't be moved" |
| `NOT_IN_SEAT` | `tests/db/moves.test.ts`: "NOT_IN_SEAT: the worker doesn't hold the source seat (they sit elsewhere)" |
| `SEAT_NOT_AVAILABLE` | `tests/db/moves.test.ts`: "SEAT_NOT_AVAILABLE: an offer_accepted seat is reserved"; "SEAT_NOT_AVAILABLE: a seat someone else fills"; "SEAT_NOT_AVAILABLE: moving a worker to the seat they already hold is rejected" |
| `SEAT_TYPE_MISMATCH` | `tests/db/moves.test.ts`: "SEAT_TYPE_MISMATCH: an employee can't fill a contingent seat"; "SEAT_TYPE_MISMATCH: a contingent worker can't fill an employee seat" |
| `INVALID_EFFECTIVE_DATE` | `tests/db/moves.test.ts`: "INVALID_EFFECTIVE_DATE: %s" (yesterday, today + 91 days, a year ago); "'today' is the UTC calendar date of the injected clock"; boundaries accepted in "accepts %s" (today, today + 90 days) |
| `EFFECTIVE_DATE_BEFORE_PENDING_CHANGE` | `tests/db/moves.test.ts`, describe "EFFECTIVE_DATE_BEFORE_PENDING_CHANGE": "rejects a date earlier than the worker's latest change"; "rejects a date earlier than the source seat's latest change"; "rejects a date earlier than the target seat's latest change"; "allows the same effective date as the latest pending change" |
| `CONFLICT` | `tests/db/moves.test.ts`: "CONFLICT: the source seat's version is stale"; "CONFLICT: a target version one ahead of the row is caught at the read, before any UPDATE"; "CONFLICT: a stale version is reported before the later checks"; "two moves racing for the same target seat: exactly one succeeds, one gets CONFLICT"; `tests/db/demo.test.ts`: "a move saved at the pre-simulate version is then a CONFLICT that writes nothing" |

The list itself is pinned by `tests/unit/move-schema.test.ts`: "lists the failure codes in check
order". That holds for every code but `CONFLICT`: it appears once in the list, at the end, because
it is one code with two check points. The early check runs right after `FORBIDDEN` (row 4 above);
the write-time check runs last (row 11). The dialog also has one client-only code, `NETWORK`, for
when the server can't be reached (`src/components/board/move-dialog.tsx:88`); it never comes from
the server.

## 4. Optimistic vs. pessimistic locking

**The problem.** Two leaders load the same board. Both drag a worker into the same open seat. If
both saves just wrote, the second would silently overwrite the first (last write wins), or the
seat could end up double-filled.

**Pessimistic locking** takes a lock when you read (`SELECT ... FOR UPDATE`) and holds it until you
write. That works inside one short transaction, but a leader's "read" is loading the board, and
their "write" is a click minutes later in a different HTTP request. You can't hold a database lock
across that think time.

**Optimistic locking (D-011)** takes no lock on read. Each seat has a `version` column
(`db/schema/app.ts:110`). The client remembers the version it saw and sends it back. The write is:

```sql
UPDATE app.seats
SET status = 'backfill', worker_id = NULL, version = version + 1, ...
WHERE seat_id = $1 AND version = $2
RETURNING version;
```

That is `src/server/services/moves.ts:191` (source seat) and `src/server/services/moves.ts:204`
(target seat), with the `WHERE` at `src/server/services/moves.ts:200`. If anyone changed the seat
since the leader loaded it, the version has moved on, the `UPDATE` matches zero rows, `RETURNING`
gives nothing, and the move returns `CONFLICT` (`src/server/services/moves.ts:202`). Because that
happens inside the transaction, everything is rolled back: no half-move, no audit row.

**Why exactly one of two racing moves wins.** Both moves can read the seat at version 3 and pass
every check. The first `UPDATE` takes a row lock. Postgres makes the second `UPDATE` wait for the
first transaction to finish. When it commits, Postgres (at the default READ COMMITTED isolation)
re-checks the second `UPDATE`'s `WHERE` against the newly committed row, which is now at version 4.
It matches zero rows, so the second move gets `CONFLICT`. The comment at
`src/server/services/moves.ts:47` says the same, and the DB test "two moves racing for the same
target seat: exactly one succeeds, one gets CONFLICT" forces this exact interleaving by waiting for
a lock waiter in `pg_stat_activity`.

**Source before target.** The source seat is emptied first, then the target filled. The partial
unique index on `app.seats.worker_id` (`db/schema/app.ts:123`) is checked row by row, so filling
the target first would briefly put the worker in two seats and fail.

## 5. The audit log: `app.seat_changes` is append-only

**Two rows per move (D-010).** A move writes a `move_out` row for the source seat and a `move_in`
row for the target, both with the same random `move_id`, in the same transaction as the seat
updates (`src/server/services/moves.ts:217`). A `CHECK` constraint requires a `move_id` on every
move row (`db/schema/app.ts:180`). Each row records the before and after status and worker, the
acting leader (from the cookie), and the effective date. The DB test "moves the worker: source
backfill, target filled, versions +1, two audit rows" checks all of it, and "records the cookie's
leader as the actor even when the input names another" checks the actor.

**Why append-only.** Audit history that can be edited isn't audit history. And dbt rebuilds the
history of every seat from these rows (D-036); if rows could change, last week's headcount could
change too. Undo (LR-02-07) is designed as a reversing insert that points at the row it reverses
(`reverses_change_id`, unique so a change can be reversed only once, `db/schema/app.ts:161`), never
an update.

**How it's enforced.**

- **A trigger** (`db/migrations/0002_seat_changes_append_only.sql:5`, attached at
  `db/migrations/0002_seat_changes_append_only.sql:12`) raises on every `UPDATE` or `DELETE`.
  `TRUNCATE` skips row triggers, so a second, statement-level trigger blocks it
  (`db/migrations/0002_seat_changes_append_only.sql:22`, attached at
  `db/migrations/0002_seat_changes_append_only.sql:32`). DB tests: "raises on UPDATE", "raises on
  DELETE", "raises on TRUNCATE unless the seed's reset setting is on for the transaction".
- **The code** never issues `UPDATE` or `DELETE` against it (a project rule the reviewer checks).
- **Grants** come with BR-07 (LR-07-01): the app will run as a role that can only `INSERT` and
  `SELECT` on `app.seat_changes`. Today the trigger is the database-level guard.

**No backdating (D-038).** Every writer, not just moves, must date its row no earlier than the
latest change on the same seat or worker. The move service rejects with
`EFFECTIVE_DATE_BEFORE_PENDING_CHANGE`; the simulated edit instead takes the later of today and the
latest recorded date (`src/server/services/demo-touch.ts:88`). An equal date is fine.

**The escape hatch.** The `TRUNCATE` trigger lets one thing through: a transaction that first runs
`SET LOCAL app.allow_seat_changes_reset = 'on'`
(`db/migrations/0002_seat_changes_append_only.sql:25`). `SET LOCAL` lasts only until that
transaction ends. The seed and the demo reset share one helper that sets it, takes the table locks,
and truncates (`scripts/seed/app-rows.ts:82`, `scripts/seed/app-rows.ts:86`). The setting does not loosen the row-level trigger: `UPDATE` and
`DELETE` still raise. It guards against accidents, not a database owner who could drop the trigger;
that is what BR-07's grants are for.

**The one recorded exception: the demo reset (D-039).** LR-04-01 adds a "Reset demo data" action
for the public demo. It is the only code under `src/` that reaches the escape hatch (through the
shared helper), and it is a deliberate, written-down exception to two project rules:

- *No leader permission check.* A reset restores the whole demo for every visitor, so a check scoped
  to one leader's squads doesn't fit (and any visitor can pick any leader anyway). Instead the action
  checks `DEMO_MODE=true` on the server first and returns `NOT_FOUND` otherwise, then calls the
  service with no leader (`src/server/actions/demo.ts:35`, `src/server/actions/demo.ts:36`).
- *It clears `app.seat_changes`* through the same `SET LOCAL` + `TRUNCATE` path the seed uses
  (`scripts/seed/app-rows.ts:82`), so it adds no new bypass and leaves the trigger unchanged.
  Inserting reversing rows instead would mean thousands of rows and a board that never returns to
  the seed state. The helper also locks `app.seats` then `app.seat_changes` first
  (`scripts/seed/app-rows.ts:85`), the same order a move takes them, so a reset and a move can't
  deadlock.

The throttle (one reset per minute) is one atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE` on a
database row, so two simultaneous clicks can't both pass
(`src/server/services/demo-reset.ts:40`; a failed claim becomes `THROTTLED` at
`src/server/services/demo-reset.ts:47`). Tests in `tests/db/reset.test.ts`: "returns the app tables
to the seed checksum after several changes, leaving workday alone", "still refuses TRUNCATE of
seat_changes outside the reset (the trigger is unchanged)", "refuses a second reset within a minute,
and allows one after a minute", "lets only one of two simultaneous resets through", and "returns
NOT_FOUND without DEMO_MODE, and writes nothing".

When BR-07 introduces a restricted app role, the reset needs its own narrow path (D-039
consequences).

## 6. The conflict demo

A real conflict needs two people. The demo fakes the second one. With `DEMO_MODE=true`, the move
dialog and a toolbar offer "Simulate another leader's edit" (LR-02-05).

- The action checks `DEMO_MODE` first, on the server (`src/server/actions/demo.ts:22`,
  `src/server/demo-mode.ts:6`). Without it the answer is `NOT_FOUND` and nothing is read or written
  (D-023). DB test: "returns NOT_FOUND when DEMO_MODE is unset, and writes nothing".
- Then the same mutation front half as a move (`runMutation`), and the service
  `simulateAnotherLeaderEdit` (`src/server/services/demo-touch.ts:35`) runs one transaction:
  permission on the seat's squad (`src/server/services/demo-touch.ts:65`), so the demo can't touch a
  seat the leader couldn't edit; a version bump with the same optimistic-lock `WHERE`
  (`src/server/services/demo-touch.ts:90`); and a `demo_touch` audit row whose actor is the seeded
  "Another leader" (`src/server/services/demo-touch.ts:107`). Who sits where doesn't change; only
  the version and the audit trail move.
- The action deliberately does not revalidate the board. The leader's open dialog still holds the
  old version, so their next save hits `CONFLICT` and they see the Refresh button. DB test: "a move
  saved at the pre-simulate version is then a CONFLICT that writes nothing".

## 7. What the database enforces vs. what the app enforces

| Rule | Database | App |
|---|---|---|
| A worker holds at most one seat | Partial unique index on `app.seats.worker_id` (`db/schema/app.ts:123`) | `NOT_IN_SEAT`, source-before-target writes |
| A filled seat has a worker; an open one doesn't | `CHECK` (`db/schema/app.ts:117`) | Moves always set status and worker together |
| Valid statuses, seat types, change types | `CHECK` constraints on `app.seats` and `app.seat_changes` | Zod and the service |
| Audit is append-only | Triggers (migration 0002); grants from BR-07 | No `UPDATE`/`DELETE` in code |
| A change is undone at most once | Unique `reverses_change_id` (`db/schema/app.ts:161`) | (LR-02-07) |
| Move rows carry a `move_id` | `CHECK` (`db/schema/app.ts:180`) | Service generates one per move |
| No lost updates | The `UPDATE ... WHERE version` row lock | `CONFLICT` result and Refresh |
| Permission on both squads | Not yet (row-level security is a production step) | `requireEditSquads` |
| Worker active, type match, receiving status | No (Workday status lives in another schema and changes on ingest) | Service checks 5 to 8 |
| Effective-date window and no backdating | No (depends on the clock and on other rows) | Service checks 9 and 10; dbt has a warn-level backstop test |

The pattern: the database guards structural invariants that must never break whatever code runs
(uniqueness, shape, history). The app guards business rules that depend on context (who is asking,
what today is, what Workday says). Where a business rule protects data integrity, like
double-seating, both layers check.

## 8. What changes in production

- **SSO instead of the acting-as cookie.** The leader comes from a verified identity (OIDC/SAML
  through the company's identity provider), and their scope from an entitlement source rather than
  a dropdown. The rest of the code doesn't change: it already takes the leader from the server,
  never from input.
- **Row-level security** in Postgres, so a leader's database session can only see and update seats
  in squads they're scoped to. Permission then lives in two layers, like double-seating does today.
- **Database roles (BR-07):** the app runs as a role with `INSERT`/`SELECT` only on
  `app.seat_changes` and no write access to `workday`.
- **Approvals.** A move above some threshold (cross-division, or one that changes headcount against
  the plan) becomes a request that another leader or HR approves, rather than an immediate write.
- **An outbox to push changes downstream.** In the same transaction as the move, insert an event
  into an outbox table; a separate worker publishes it to Workday or other systems and retries on
  failure. That avoids the "wrote the database but the API call failed" split. Today nothing is
  pushed: the app is the plan of record and Workday is read-only to it.
- **Undo.** Undo (LR-02-07) is a reversing insert.

## 9. The seat history panel (LR-02-06)

Clicking a seat card selects it (`?seat=<id>` in the URL), and the board page renders that seat's
audit rows beside the board (`src/app/board/page.tsx:102`).

- **A read, not a mutation.** `getSeatHistory` (`src/server/queries/history.ts:36`) parses the seat
  id with Zod and returns no rows for an invalid one (`src/server/queries/history.ts:38`). The seat
  id and the row limit are bound values in the `sql` tagged template
  (`src/server/queries/history.ts:50`), never string-built.
- **"Newest" means last saved, not latest effective date.** The order is
  `created_at desc, change_id desc` (`src/server/queries/history.ts:51`): the two rows of one move
  share a transaction timestamp, so `change_id` breaks the tie with the later insert. Each entry
  shows both the saved time and the effective date
  (`src/components/seat-history-panel.tsx:115`). DB test: "returns
  one seat's rows newest first, ties broken by change_id descending, and no other seat's rows"
  (`tests/db/history.test.ts:43`), which inserts rows out of time order so neither insert order
  nor `change_id` alone would pass.
- **An index on `app.seat_changes (seat_id)`** (`db/schema/app.ts:163`, migration
  `db/migrations/0005_clever_sunset_bain.sql:1`) so the lookup doesn't scan the whole audit log.
  The seed table is small, so the planner would pick a sequential scan anyway; the DB test "the
  seat_id index exists and the history lookup can use it" (`tests/db/history.test.ts:130`) sets
  `enable_seqscan = off` and checks that `EXPLAIN` of a simplified query (no joins, same `WHERE`
  and `ORDER BY`) names `seat_changes_seat_id_idx`.
- **The click-after-drag guard.** A drag that ends over its own card is followed by a browser
  click on that card, which would select the seat by accident. `onDragEnd` (and `onDragCancel`)
  record the time (`src/components/board/board-view.tsx:130`), and `selectSeat` ignores a click
  within 300 ms of it (`src/components/board/board-view.tsx:65`, constant at
  `src/components/board/board-view.tsx:35`).

## 10. Likely interview questions

1. **Why not let the client send the leader id?** Anything in the request body can be forged. The
   leader comes from a server-side cookie that's validated against `app.leaders` on every request,
   and the schema has no leader field, so a spoofed one is dropped.
2. **Why optimistic locking instead of `SELECT ... FOR UPDATE`?** The read (loading the board) and
   the write (clicking Save) happen in different HTTP requests minutes apart; you can't hold a
   database lock across that. Conflicts are rare, so check at write time: `WHERE version = $n`, and
   zero rows means `CONFLICT`.
3. **Two people save the same seat at the same instant. What happens?** Both `UPDATE`s target the
   same row; Postgres makes the second wait, then re-checks its `WHERE` against the committed row.
   The version has moved on, so it matches zero rows and returns `CONFLICT`. A DB test forces that
   interleaving.
4. **Why check `CONFLICT` before the business rules?** So the rules validate exactly the rows the
   write will touch. Otherwise a forged or stale version could pass the checks on one state and
   write onto another.
5. **Why is the audit log append-only, and how do you enforce it?** History has to be trustworthy,
   and dbt rebuilds seat history from it. A trigger raises on `UPDATE`, `DELETE` and `TRUNCATE`;
   code never issues them; BR-07 adds grants.
6. **Then how does the seed or the demo reset clear it?** One escape hatch: `TRUNCATE` is allowed
   only in a transaction that sets `app.allow_seat_changes_reset` with `SET LOCAL`. The demo reset
   is a recorded exception (D-039) gated by `DEMO_MODE` and a throttle; the helper both use is in
   `scripts/seed/app-rows.ts:81`.
7. **Why two audit rows per move instead of one?** Each row is about one seat, so a seat's history
   is a simple filter on `seat_id`. The shared `move_id` ties the pair back together.
8. **Why can't a move be backdated?** dbt rebuilds seat state as of each report date, ordered by
   effective date. A backdated row could rewrite already-modeled history or put a worker in two
   seats on a past date. So the window is today to +90 days, and no row may predate a change already
   recorded for its seat or worker.
9. **Why do you check permission on both squads?** A move takes a person out of one team and into
   another. Being allowed to staff the destination doesn't mean you can take people from someone
   else's team.
10. **What does the database enforce, and what does the app?** The database enforces structure that
    must never break: one seat per worker, filled-has-worker, valid enums, append-only history. The
    app enforces context-dependent rules: permission, Workday status, the date window.
11. **What happens if Workday says someone is terminated but they still hold a seat?** The board
    still renders and flags it; it's a reconciliation exception for dbt to report, not a crash.
    They can't be moved (`WORKER_NOT_ACTIVE`).
12. **What would you change for production?** SSO for identity, row-level security so permission
    lives in the database too, restricted database roles, approvals for big moves, and an outbox
    table to push changes downstream reliably.
