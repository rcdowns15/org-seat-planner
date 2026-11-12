import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

export const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../db/migrations");

// Applies every pending migration in db/migrations, in one transaction, and records each in
// drizzle.__drizzle_migrations (the migrator creates that schema and table on first run).
// Already-applied migrations are skipped, so running it again is a no-op.
// Returns how many migrations were applied by this call.
export async function runMigrations(connectionString: string): Promise<number> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const before = await countApplied(client);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    return (await countApplied(client)) - before;
  } finally {
    await client.end();
  }
}

async function countApplied(client: Client): Promise<number> {
  const res = await client.query<{ n: number }>(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`,
  );
  if (res.rows[0].n === 0) return 0;
  const applied = await client.query<{ n: number }>(
    "select count(*)::int as n from drizzle.__drizzle_migrations",
  );
  return applied.rows[0].n;
}

// Error text for logs, with the connection string removed in case a driver ever echoes it.
export function safeErrorMessage(err: unknown, connectionString: string | undefined): string {
  const code = (err as { code?: string }).code;
  let message = err instanceof Error ? err.message : String(err);
  if (connectionString) message = message.split(connectionString).join("[connection string]");
  return code ? `${code}: ${message}` : message;
}
