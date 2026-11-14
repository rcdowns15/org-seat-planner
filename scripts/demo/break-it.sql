-- "Try to break it": attack the write path directly, in SQL, and see what stops you (LR-04-07).
--
-- LOCAL ONLY. Run it against the Docker Compose database, never a deployed one. Everything runs in
-- one transaction that ends in ROLLBACK, so it writes nothing (check: `pnpm db:seed:check` prints
-- the same checksum before and after). It carries no connection string: you supply the connection.
-- Run on a freshly seeded local DB (`pnpm db:seed`) for the results to match the comments.
--
-- Run it (after `docker compose up -d db`, `pnpm db:migrate`, `pnpm db:seed`):
--   psql -h localhost -U seatplanner -d seatplanner -f scripts/demo/break-it.sql
--   # no psql on the host? run the one inside the container (its host is a local socket):
--   docker exec -i org-seat-planner-db-1 psql -U seatplanner -d seatplanner < scripts/demo/break-it.sql
--
-- Guard: psql's built-in :HOST variable is the server host of the connection (or the socket
-- directory, which starts with "/", for a local socket). Anything other than localhost, 127.0.0.1,
-- ::1 or a socket makes the script quit before it touches anything. The guard stops accidents, not
-- deliberate bypasses (e.g. `hostaddr=` with `host=localhost`, or a local port-forward to a remote
-- database).
--
-- Errors: ON_ERROR_STOP is off so psql keeps going after a rejected statement. In Postgres a failed
-- statement aborts the whole transaction, so each attempt runs after its own SAVEPOINT and ends
-- with ROLLBACK TO SAVEPOINT; a rejected attempt (or a successful one) never affects the next.
--
-- Fixtures (scripts/seed/README.md): seat 28 holds worker 100042 (employee seat, filled), seat 39
-- holds worker 100052, seat 206 is an open employee seat, leader 100002 is the demo division leader.

\set ON_ERROR_STOP off
\set ECHO queries
\pset pager off

SELECT (:'HOST' IN ('localhost', '127.0.0.1', '::1') OR :'HOST' LIKE '/%') AS is_local \gset
\if :is_local
\else
  \echo 'break-it.sql is LOCAL ONLY: refusing to run against host' :HOST
  \quit
\endif

\echo
\echo '=== Setup: one audit row to attack (the seeded seat_changes table starts empty) ==='
BEGIN;

-- Expect: INSERT 0 1. Inserting is the one thing the audit log allows.
INSERT INTO app.seat_changes
  (seat_id, change_type, worker_id, from_status, to_status, from_worker_id, to_worker_id,
   actor_leader_id, effective_date, note)
SELECT 28, 'demo_touch', '100042', 'filled', 'filled', '100042', '100042',
       leader_id, current_date, 'break-it.sql setup row (rolled back)'
FROM app.leaders WHERE worker_id = '100002';

\echo
\echo '=== 1. UPDATE a seat_changes row ==='
\echo 'Expect: ERROR from trigger seat_changes_no_update_delete (append-only, D-010).'
SAVEPOINT attempt;
UPDATE app.seat_changes SET note = 'tampered' WHERE seat_id = 28;
ROLLBACK TO SAVEPOINT attempt;

\echo
\echo '=== 2. DELETE a seat_changes row ==='
\echo 'Expect: ERROR from the same trigger. History cannot be erased.'
SAVEPOINT attempt;
DELETE FROM app.seat_changes WHERE seat_id = 28;
ROLLBACK TO SAVEPOINT attempt;

\echo
\echo '=== 3. TRUNCATE seat_changes ==='
\echo 'Expect: ERROR from trigger seat_changes_no_truncate. Only the seed and the demo reset can pass'
\echo '        it, by first running SET LOCAL app.allow_seat_changes_reset (D-039); we do not.'
SAVEPOINT attempt;
TRUNCATE app.seat_changes;
ROLLBACK TO SAVEPOINT attempt;

\echo
\echo '=== 4. One worker in two seats ==='
\echo 'Expect: ERROR duplicate key, unique index seats_worker_id_key. Worker 100042 already holds seat'
\echo '        28, so a second seat (open seat 206) is refused by the database, whatever code asks.'
SAVEPOINT attempt;
UPDATE app.seats SET status = 'filled', worker_id = '100042', version = version + 1
WHERE seat_id = 206;
ROLLBACK TO SAVEPOINT attempt;

\echo
\echo '=== 5. A second worker in a filled seat (a worker who is already seated elsewhere) ==='
\echo 'Expect: ERROR duplicate key, the same index: 100052 holds seat 39, so seat 28 cannot take them.'
SAVEPOINT attempt;
UPDATE app.seats SET worker_id = '100052', version = version + 1 WHERE seat_id = 28;
ROLLBACK TO SAVEPOINT attempt;

\echo
\echo '=== 6. A "filled" seat with no worker ==='
\echo 'Expect: ERROR, check constraint seats_filled_has_worker_check (filled iff a worker is set).'
SAVEPOINT attempt;
UPDATE app.seats SET status = 'filled', worker_id = NULL, version = version + 1 WHERE seat_id = 206;
ROLLBACK TO SAVEPOINT attempt;

\echo
\echo '=== 7. Overwrite a filled seat with a worker who holds no seat ==='
\echo 'Expect: UPDATE 1 (SUCCEEDS). Honest limit: the database allows it. The old occupant (100042)'
\echo '        is silently displaced and nothing is audited. The app stops it: moves only go into'
\echo '        open/backfill seats (SEAT_NOT_AVAILABLE) and are audited. Same for worker status and'
\echo '        worker type vs. seat type: only the app checks those.'
SAVEPOINT attempt;
UPDATE app.seats
SET worker_id = (
      SELECT w.worker_id FROM workday.workers w
      WHERE w.status = 'active' AND w.worker_type = 'employee'
        AND NOT EXISTS (SELECT 1 FROM app.seats s WHERE s.worker_id = w.worker_id)
      ORDER BY w.worker_id LIMIT 1),
    version = version + 1
WHERE seat_id = 28;
SELECT seat_id, status, worker_id, version FROM app.seats WHERE seat_id = 28;
ROLLBACK TO SAVEPOINT attempt;

\echo
\echo '=== 8. Optimistic locking: the app''s statement shape vs. a raw UPDATE ==='
\echo 'Seat 206 is read at its current version (a fresh seed: 0). Leaders A and B both loaded it at that version.'
SELECT version AS v206 FROM app.seats WHERE seat_id = 206 \gset
SAVEPOINT attempt;

\echo 'Leader A saves with the app''s shape (WHERE seat_id AND version, then version + 1).'
\echo 'Expect: UPDATE 1.'
UPDATE app.seats SET status = 'backfill', version = version + 1
WHERE seat_id = 206 AND version = :v206;

\echo 'Leader B saves with the same shape and the now-stale version.'
\echo 'Expect: UPDATE 0. Zero rows is how the app detects CONFLICT (D-011) and rolls back.'
UPDATE app.seats SET status = 'open', version = version + 1
WHERE seat_id = 206 AND version = :v206;

\echo 'A raw UPDATE with no version check, as someone with database access could run it.'
\echo 'Expect: UPDATE 1 (SUCCEEDS). Nothing in the database forces the version check: optimistic'
\echo 'locking lives in the app''s statement shape, so every writer must use it. This overwrites A.'
UPDATE app.seats SET status = 'open' WHERE seat_id = 206;
SELECT seat_id, status, worker_id, version FROM app.seats WHERE seat_id = 206;
ROLLBACK TO SAVEPOINT attempt;

\echo
\echo '=== Done: rolling back everything. Nothing was written. ==='
ROLLBACK;
