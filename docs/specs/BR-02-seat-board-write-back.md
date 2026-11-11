# BR-02 — Seat board and write-back (the centerpiece)

**Status:** todo · **Depends on:** BR-01 · **Milestone:** M2 (thin slice = LR-02-01…04) · **Target:** Fri 11/13 – Sat 11/14 · **Cut line:** LR-02-01…06 and LR-02-08; LR-02-07 and LR-02-09 come after the interview

## Goal
A leader picks who they're acting as, sees their org as a board of squads and seat cards, and drags a
person to an open seat in another squad with an effective date. The server validates the move,
saves it in one transaction with optimistic locking, and appends to the audit trail. A conflict
demo, per-seat history, and an "Under the hood" SQL panel make the write-back visible. The
functionality stays deliberately small so every line can be explained; the patterns (server-side
validation, version-checked writes, append-only audit) are the ones a production tool needs.

## Why it matters
This is the skill the role needs: an internal tool whose edits save back correctly. Every
interview question about write-back (permissions, validation, concurrency, audit) is answered by
code and tests in this big rock.

## Scope
In (cut line): mock auth (acting-as), permissions, board, move service, drag-and-drop + keyboard
move, effective dates, conflict handling + simulate button, per-seat history, read-only SQL panel.
After the interview: undo (LR-02-07), org-wide audit log page (LR-02-09).
Out: Workday ingestion and reconciliation (BR-03), dashboard (BR-08), real auth (parked).

## Key risks / open questions
- dnd-kit drag in Playwright can be flaky. The keyboard "Move to…" path gives a stable fallback,
  but the smoke test must still exercise a real drag at least once.
- Effective-date semantics (D-012): the board shows the planned state as soon as a move is saved;
  `effective_date` is recorded for analytics. Confirm with Rob.

## Exit criteria
- Playwright: drag a worker to an open seat in another squad, save, see it on the board, and the
  audit log shows the move. Runs green in CI.
- `pnpm test:db` covers every validation failure code, the version conflict and concurrent saves,
  and each failure case asserts that nothing was written.
- The conflict demo and the SQL panel work on the deployed app.
- (After the interview) undo and the audit log page, per LR-02-07 and LR-02-09.

## Little rocks
Parallel: LR-02-01 and LR-02-02 together; LR-02-05, LR-02-06 and LR-02-08 together after LR-02-04
(the orchestrator checks file overlap first).

### LR-02-01 · Acting-as leader and permission service · status: todo · depends: LR-01-07 · owner: agent · executor model: sonnet
A header dropdown lists the seeded leaders; choosing one sets an `acting_leader_id` cookie through a
server action. `getActingLeader()` (server-only) reads and validates the cookie against
`app.leaders`. `canEditSquad(leader, squadId)` implements division and group scopes (D-013). No
leader selected means read-only mode.
- [ ] Unit/DB test table: demo division leader can edit every squad in their division and none outside; demo group leader only their group's squads
- [ ] A cookie with an unknown or malformed leader ID yields read-only mode (test)
- [ ] Server actions never accept a leader ID in their input; a test shows a spoofed field is ignored
Likely files: `src/server/auth/acting-leader.ts`, `src/server/services/permissions.ts`, `src/server/actions/acting-as.ts`, `src/components/leader-switcher.tsx`, `src/app/layout.tsx`, `tests/db/permissions.test.ts`.

### LR-02-02 · Read-only org board · status: todo · depends: LR-01-07 · owner: agent · executor model: sonnet
`/board`: pick a division and group (defaults to the acting leader's scope); each squad is a column
of seat cards showing one of five states: filled (employee), filled (contingent), open, backfill,
offer accepted. Each state has a label and icon (not color alone). Cards show name and title for
filled seats. Squad header shows filled / approved seats. Data comes from one server-side query
module. Don't touch the header layout (LR-02-01 owns it).
- [ ] e2e: for the demo group, the number of squads and the per-state card counts match a SQL count in the test
- [ ] Each of the five states renders with its own text label (e2e or component test)
- [ ] The board query is parameterized and lives in `src/server/queries/board.ts`
Likely files: `src/app/board/page.tsx`, `src/components/board/*`, `src/server/queries/board.ts`, `tests/e2e/board.spec.ts`.

### LR-02-03 · Move service: validation, transaction, locking, audit · status: todo · depends: LR-02-01 · owner: agent · executor model: opus
`moveWorker(input, leader)` in `src/server/services/moves.ts`, called by a server action. Zod input:
`workerId`, `fromSeatId`, `toSeatId`, `effectiveDate`, `fromSeatVersion`, `toSeatVersion`. In one
transaction it checks, in order, and returns a typed failure code for each: `INVALID_INPUT`,
`FORBIDDEN` (permission on both squads), `WORKER_NOT_ACTIVE` (Workday status must be `active`),
`NOT_IN_SEAT` (worker isn't in `fromSeatId`, which also catches double-seating), `SEAT_NOT_AVAILABLE`
(target must be `open` or `backfill`), `SEAT_TYPE_MISMATCH`, `INVALID_EFFECTIVE_DATE` (today to +90
days), `CONFLICT` (either version stale). On success: the source seat becomes `backfill` with no
worker, the target becomes `filled`, both versions +1, and two `seat_changes` rows share a `move_id`.
Record the SQL statements the transaction ran (for LR-02-08) in a small server-side ring buffer.
- [ ] `pnpm test:db` has one test per failure code; each asserts both seat rows and the `seat_changes` count are unchanged
- [ ] Success test: both versions incremented, source is `backfill`, target is `filled`, exactly 2 audit rows with the same `move_id`, the acting leader and the effective date
- [ ] Concurrency test: two `moveWorker` calls racing for the same target seat result in exactly one success and one `CONFLICT`
- [ ] Every query uses bound parameters (reviewer check); the seat update SQL includes `AND version = $n`
Likely files: `src/server/services/moves.ts`, `src/server/actions/move.ts`, `src/lib/schemas/move.ts`, `src/lib/results.ts`, `src/server/sql-log.ts`, `tests/db/moves.test.ts`, `tests/unit/move-schema.test.ts`.

### LR-02-04 · Drag-and-drop move with save dialog (thin slice complete) · status: todo · depends: LR-02-02, LR-02-03 · owner: agent · executor model: sonnet
With dnd-kit, a filled card can be dragged onto an `open` or `backfill` card the leader can edit.
Dropping opens a dialog: who moves, from where, to where, an effective-date picker (default today),
Save and Cancel. Save calls the move action; a failure shows its message in the dialog and the
board is unchanged; success closes the dialog and the board refreshes (`revalidatePath`). Every
filled card also has a "Move to…" menu (keyboard accessible) that opens the same dialog.
- [ ] Playwright smoke (in CI): as the demo division leader, drag a worker from squad A to an open seat in squad B, save; the worker shows in B, and a DB check finds 2 new `seat_changes` rows
- [ ] Playwright: as the demo group leader, a move into a squad outside their group shows the `FORBIDDEN` message and the board is unchanged
- [ ] Playwright: the "Move to…" path completes a move with the keyboard only
Likely files: `src/components/board/*`, `src/components/move-dialog.tsx`, `src/app/board/page.tsx`, `tests/e2e/move.spec.ts`.

### LR-02-05 · Conflict handling and "simulate another leader's edit" · status: todo · depends: LR-02-04 · owner: agent · executor model: sonnet
A `CONFLICT` result shows "This seat changed since you loaded it" with a Refresh button that
reloads the board and keeps the dialog's selection when it's still valid. A "Simulate another
leader's edit" button (shown only when `DEMO_MODE=true`) lets you pick a seat on screen. The server
bumps that seat's version and writes a `seat_changes` row (`change_type = 'demo_touch'`, actor = a
seeded "Another leader") so the audit trail stays honest.
- [ ] Playwright: open the move dialog, click simulate on the target seat, save, see the conflict message; Refresh then Save succeeds
- [ ] DB test: the simulate action returns 404 when `DEMO_MODE` is unset, and writes nothing
- [ ] The simulated edit appears in that seat's history (DB test)
Likely files: `src/server/actions/demo.ts`, `src/server/demo-mode.ts`, `src/components/move-dialog.tsx`, `src/components/demo-toolbar.tsx`, `tests/e2e/conflict.spec.ts`, `tests/db/demo.test.ts`.

### LR-02-06 · Seat history panel · status: todo · depends: LR-02-04 · owner: agent · executor model: sonnet
Clicking a seat card opens a side panel with that seat's `seat_changes`, newest first: what changed,
who did it, when it was saved, the effective date.
- [ ] DB test: history query returns rows newest first and only for that seat
- [ ] e2e: after a move, both seats' history panels show it
Likely files: `src/server/queries/history.ts`, `src/components/seat-history-panel.tsx`, `tests/db/history.test.ts`, `tests/e2e/history.spec.ts`.

### LR-02-07 · Undo a move (after the interview) · status: todo · depends: LR-02-03, LR-02-06 · owner: agent · executor model: sonnet
"Undo" on a move in the history panel or audit log calls `undoMove(moveId, leader)`: permission on
both squads, both seats still at the versions the move left them (else `CONFLICT`), not already
undone (else `ALREADY_UNDONE`). It restores the previous seat states with version +1 and inserts
two reversing rows with `reverses_change_id`. Nothing is updated in or deleted from `seat_changes`.
- [ ] DB test: move then undo restores both seats' status and worker; `seat_changes` has 4 rows for the pair, with no deletes
- [ ] DB test: undoing twice returns `ALREADY_UNDONE`; undo after another change to either seat returns `CONFLICT`
- [ ] e2e: undo from the history panel puts the worker back on the board
Likely files: `src/server/services/undo.ts`, `src/server/actions/undo.ts`, `src/components/seat-history-panel.tsx`, `tests/db/undo.test.ts`, `tests/e2e/undo.spec.ts`.

### LR-02-08 · "Under the hood" read-only SQL panel · status: todo · depends: LR-02-04 · owner: agent · executor model: sonnet
A collapsible panel (and a `/sql` page) that makes the write-back visible. **Read-only, preset
queries only** (D-026). Each query shows its SQL text and its result table:
- the selected seat's row, including `version`
- the latest 10 `seat_changes` rows
- the selected worker's Workday record (status, type, manager)
- open and backfill seats per squad vs. the approved plan for the current quarter

It also shows **"Last save: SQL executed"**, the parameterized statements from the most recent move or
undo (from LR-02-03's ring buffer), with their bound values, so a viewer sees the
`UPDATE ... WHERE version = $n` and the audit `INSERT`s. Queries take only typed IDs as bound
parameters and run in a `READ ONLY` transaction with a 2-second `statement_timeout` and a 200-row
limit.
- [ ] e2e: make a move, open the panel: the seat row shows the incremented `version` and the latest `seat_changes` row is the move
- [ ] e2e: "Last save" shows an `UPDATE` containing `version =` and two `INSERT INTO app.seat_changes` statements
- [ ] DB test: the panel's query runner rejects a write (run inside the `READ ONLY` transaction) and stops a slow query at the timeout
- [ ] No free-text SQL input exists anywhere in the UI or the server actions (reviewer check)
Likely files: `src/server/queries/under-the-hood.ts`, `src/server/sql-log.ts`, `src/components/sql-panel.tsx`, `src/app/sql/page.tsx`, `tests/db/sql-panel.test.ts`, `tests/e2e/sql-panel.spec.ts`.

### LR-02-09 · Org-wide audit log page (after the interview) · status: todo · depends: LR-02-06 · owner: agent · executor model: sonnet
`/audit` lists all changes, paginated (50 per page), filterable by leader, squad and date range,
with each move shown as one line (grouped by `move_id`).
- [ ] DB test: filters (leader, squad, date range) and pagination return the right rows; filter values are bound parameters
- [ ] e2e: after a move, the audit page's first row describes it
Likely files: `src/server/queries/audit.ts`, `src/app/audit/page.tsx`, `tests/db/audit.test.ts`, `tests/e2e/audit.spec.ts`.
