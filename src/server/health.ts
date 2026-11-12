import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

export type HealthBody = {
  ok: boolean;
  db: "ok" | "down";
  seats: number | null;
};

export type HealthResult = { status: 200 | 503; body: HealthBody };

// Returns the seat count, or null when the schema doesn't exist yet. Rejects if the DB is down.
async function querySeatCount(): Promise<number | null> {
  try {
    const res = await getDb().execute<{ n: string }>(sql`select count(*) as n from app.seats`);
    return Number(res.rows[0].n);
  } catch (err) {
    // 42P01 = undefined_table: connected fine, the app schema just isn't migrated yet.
    if ((err as { code?: string }).code === "42P01") return null;
    throw err;
  }
}

// The query is injectable so unit tests don't need a database.
export async function checkDatabase(
  countSeats: () => Promise<number | null> = querySeatCount,
): Promise<HealthResult> {
  try {
    const seats = await countSeats();
    return { status: 200, body: { ok: true, db: "ok", seats } };
  } catch (err) {
    // Server-side log only: the error code or message, never a connection string.
    console.error(
      "health check failed:",
      (err as { code?: string }).code ?? (err instanceof Error ? err.message : String(err)),
    );
    return { status: 503, body: { ok: false, db: "down", seats: null } };
  }
}
