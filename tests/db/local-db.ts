import { config } from "dotenv";

// Loads DATABASE_URL for the db test project and refuses anything that isn't the local Docker
// database. Used by both the global setup (migrations) and the per-file setup (the tests).
export function requireLocalDatabaseUrl(): string {
  // Same precedence as Next: .env.local, then .env; fall back to the Docker Compose default.
  config({ path: [".env.local", ".env"], quiet: true });
  process.env.DATABASE_URL ??= "postgres://seatplanner:seatplanner@localhost:5432/seatplanner";

  // Tests write and truncate tables, so refuse any non-local database (e.g. after `vercel env pull`).
  const { hostname } = new URL(process.env.DATABASE_URL);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      `pnpm test:db only runs against the local Docker database (DATABASE_URL host is "${hostname}").`,
    );
  }
  return process.env.DATABASE_URL;
}
