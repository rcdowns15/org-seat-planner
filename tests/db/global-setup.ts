import { runMigrations, safeErrorMessage } from "../../scripts/db/run-migrations";
import { requireLocalDatabaseUrl } from "./local-db";

// Runs once before the db test project: applies pending migrations to the local database, so
// `pnpm test:db` is one command. Idempotent: already-applied migrations are skipped.
export default async function setup(): Promise<void> {
  const url = requireLocalDatabaseUrl();
  try {
    await runMigrations(url);
  } catch (err) {
    throw new Error(
      `test:db could not migrate the local database (is \`docker compose up -d db\` running?): ${safeErrorMessage(err, url)}`,
    );
  }
}
