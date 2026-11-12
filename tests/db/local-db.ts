import { config } from "dotenv";

const LOCAL_URL = "postgres://seatplanner:seatplanner@localhost:5432/seatplanner";

// Throws unless the URL points at localhost. Pure, so a unit test can cover it.
export function assertLocalUrl(name: string, url: string): void {
  const { hostname } = new URL(url);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      `pnpm test:db only runs against the local Docker database (${name} host is "${hostname}").`,
    );
  }
}

// Checks both URLs the seed and migrate scripts can read: they prefer DATABASE_URL_UNPOOLED.
export function assertLocalUrls(env: Record<string, string | undefined>): void {
  if (env.DATABASE_URL) assertLocalUrl("DATABASE_URL", env.DATABASE_URL);
  if (env.DATABASE_URL_UNPOOLED) assertLocalUrl("DATABASE_URL_UNPOOLED", env.DATABASE_URL_UNPOOLED);
}

// Loads DATABASE_URL for the db test project and refuses anything that isn't the local Docker
// database. Used by both the global setup (migrations) and the per-file setup (the tests).
export function requireLocalDatabaseUrl(): string {
  // Same precedence as Next: .env.local, then .env; fall back to the Docker Compose default.
  config({ path: [".env.local", ".env"], quiet: true });
  process.env.DATABASE_URL ??= LOCAL_URL;

  // Tests write and truncate tables, so refuse any non-local database (e.g. after `vercel env pull`).
  assertLocalUrls(process.env);
  return process.env.DATABASE_URL;
}

// Environment for child processes that run the seed or migrate scripts: both URLs pinned to the
// verified local database, so a stray DATABASE_URL_UNPOOLED can never be preferred.
export function localChildEnv(url: string): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url };
}
