import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { expect } from "vitest";
import { getPool } from "@/server/db";

// Runs `fn` inside a transaction that always rolls back, so tests leave no rows behind and
// don't depend on (or disturb) seed data.
export async function withRollback(fn: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

// Asserts the statement fails with the given SQLSTATE. Runs it inside a savepoint so the
// surrounding transaction stays usable for later statements.
export async function expectSqlState(
  client: PoolClient,
  sqlState: string,
  text: string,
  values: unknown[] = [],
): Promise<{ message: string; constraint?: string }> {
  await client.query("savepoint expect_error");
  try {
    await client.query(text, values);
  } catch (err) {
    await client.query("rollback to savepoint expect_error");
    const e = err as { code?: string; message: string; constraint?: string };
    expect(e.code, e.message).toBe(sqlState);
    return { message: e.message, constraint: e.constraint };
  }
  await client.query("release savepoint expect_error");
  throw new Error(`expected SQLSTATE ${sqlState}, but the statement succeeded: ${text}`);
}

export type Fixture = { squadId: number; leaderId: number; suffix: string };

// Inserts a minimal hierarchy (division → group → squad) and one leader. Names get a random
// suffix so parallel test files never collide on unique names.
export async function insertFixture(client: PoolClient): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const division = await client.query<{ division_id: number }>(
    "insert into app.divisions (name) values ($1) returning division_id",
    [`Test Division ${suffix}`],
  );
  const divisionId = division.rows[0].division_id;
  const group = await client.query<{ group_id: number }>(
    "insert into app.groups (division_id, name) values ($1, $2) returning group_id",
    [divisionId, `Test Group ${suffix}`],
  );
  const squad = await client.query<{ squad_id: number }>(
    "insert into app.squads (group_id, name) values ($1, $2) returning squad_id",
    [group.rows[0].group_id, `Test Squad ${suffix}`],
  );
  const leader = await client.query<{ leader_id: number }>(
    `insert into app.leaders (worker_id, display_name, scope_type, division_id)
     values ($1, $2, 'division', $3) returning leader_id`,
    [`test-leader-${suffix}`, `Test Leader ${suffix}`, divisionId],
  );
  return { squadId: squad.rows[0].squad_id, leaderId: leader.rows[0].leader_id, suffix };
}

export async function insertSeat(
  client: PoolClient,
  squadId: number,
  status: string,
  workerId: string | null,
): Promise<number> {
  const res = await client.query<{ seat_id: number }>(
    `insert into app.seats (squad_id, seat_type, status, worker_id)
     values ($1, 'employee', $2, $3) returning seat_id`,
    [squadId, status, workerId],
  );
  return res.rows[0].seat_id;
}
