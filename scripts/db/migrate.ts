// `pnpm db:migrate`: apply pending migrations to the database in DATABASE_URL_UNPOOLED, falling
// back to DATABASE_URL (D-007: migrations use the direct connection, not Neon's pooler).
// Runs against any host (local Docker, Neon in db-deploy), and never prints the connection string.
import { config } from "dotenv";
import { runMigrations, safeErrorMessage } from "./run-migrations";

// Same precedence as Next: .env.local, then .env. Variables already set in the shell win.
config({ path: [".env.local", ".env"], quiet: true });

async function main(): Promise<void> {
  const source = process.env.DATABASE_URL_UNPOOLED ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL";
  const connectionString = process.env[source];
  if (!connectionString) {
    console.error(
      "db:migrate: set DATABASE_URL_UNPOOLED or DATABASE_URL (see .env.example and README).",
    );
    process.exit(1);
  }

  try {
    const applied = await runMigrations(connectionString);
    console.log(
      applied === 0
        ? `db:migrate: up to date (using ${source}); nothing to apply.`
        : `db:migrate: applied ${applied} migration(s) (using ${source}).`,
    );
  } catch (err) {
    console.error(`db:migrate failed: ${safeErrorMessage(err, connectionString)}`);
    process.exit(1);
  }
}

void main();
