import "server-only";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { RESET_THROTTLE_SECONDS, type ResetDemoResult } from "@/lib/schemas/demo";
import { getPool } from "@/server/db";
import { generateAppRows, insertAppRows, truncateAppTables } from "../../../scripts/seed/app-rows";

// Restores the `app` tables to the seed (LR-04-01), in one transaction. The caller (the action)
// has already checked DEMO_MODE (D-023).
//
// - Only `app` is touched. The `workday` tables are the app's read-only input (D-015); the full
//   reset, including Workday, stays `pnpm db:seed` / db-deploy with `reseed: true`.
// - app.seat_changes is append-only (D-010), but restoring the seed means emptying it. That takes
//   a TRUNCATE, which the table's guard allows only after `SET LOCAL app.allow_seat_changes_reset`
//   (inside truncateAppTables). This is the one sanctioned exception to "never delete audit
//   rows": demo-only, behind DEMO_MODE, shared with the seed, and never UPDATE or DELETE.
//   The trigger and BR-07's grants are unchanged.
//   Sanctioned by D-039 (also see its first exception: this action has no leader permission check).
// - Throttle: one reset per RESET_THROTTLE_SECONDS. The last-reset time is a row in the database
//   (app.demo_reset_state) rather than a variable in memory, because on Vercel each request may
//   run on a different serverless instance and memory is not shared. The claim is one atomic
//   INSERT ... ON CONFLICT DO UPDATE ... WHERE, so two simultaneous clicks cannot both pass: the
//   second waits on the row lock, re-checks the WHERE and gets zero rows back. The claim is made
//   first in the same transaction, so a failed reset rolls the claim back too.
class Throttled extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("throttled");
  }
}

export async function resetDemoData(options: { now?: Date } = {}): Promise<ResetDemoResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - RESET_THROTTLE_SECONDS * 1000);
  const rows = generateAppRows();
  const db = drizzle(getPool());
  try {
    await db.transaction(async (tx) => {
      const claimed = await tx.execute(sql`
        INSERT INTO app.demo_reset_state (id, last_reset_at)
        VALUES (1, ${now.toISOString()}::timestamptz)
        ON CONFLICT (id) DO UPDATE SET last_reset_at = EXCLUDED.last_reset_at
          WHERE app.demo_reset_state.last_reset_at <= ${cutoff.toISOString()}::timestamptz
        RETURNING id
      `);
      if (claimed.rows.length === 0) {
        const last = await tx.execute<{ last_ms: string }>(
          sql`SELECT (extract(epoch FROM last_reset_at) * 1000)::bigint::text AS last_ms
              FROM app.demo_reset_state WHERE id = 1`,
        );
        const lastMs = Number(last.rows[0].last_ms);
        const wait = Math.ceil((lastMs + RESET_THROTTLE_SECONDS * 1000 - now.getTime()) / 1000);
        throw new Throttled(Math.max(1, wait));
      }
      await truncateAppTables(tx);
      await insertAppRows(tx, rows);
    });
  } catch (err) {
    if (err instanceof Throttled) {
      return {
        ok: false,
        code: "THROTTLED",
        message: `Demo data was reset a moment ago. Try again in ${err.retryAfterSeconds} seconds.`,
      };
    }
    console.error("demo reset failed:", err instanceof Error ? err.message : "unknown error");
    return {
      ok: false,
      code: "FAILED",
      message: "Could not reset the demo data. Nothing was changed.",
    };
  }
  return { ok: true, seats: rows.seats.length, resetAt: now.toISOString() };
}
