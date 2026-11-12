// `pnpm db:seed`: wipe and reseed app + workday from the fixed seed, write the two Workday report
// CSVs to data/workday/, and print a checksum of the seeded rows.
// `pnpm db:seed:check`: print the checksum of what is in the database now.
// Like db:migrate, it uses DATABASE_URL_UNPOOLED, falling back to DATABASE_URL, and never prints
// the connection string.
import { config } from "dotenv";
import { checkSeed, runSeed } from "./run-seed";

config({ path: [".env.local", ".env"], quiet: true });

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const name = check ? "db:seed:check" : "db:seed";
  const source = process.env.DATABASE_URL_UNPOOLED ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL";
  const connectionString = process.env[source];
  if (!connectionString) {
    console.error(`${name}: set DATABASE_URL_UNPOOLED or DATABASE_URL (see .env.example).`);
    process.exit(1);
  }

  try {
    if (check) {
      console.log(`seed checksum: ${await checkSeed(connectionString)}`);
      return;
    }
    const result = await runSeed(connectionString);
    const counts = Object.entries(result.counts)
      .map(([table, n]) => `${n} ${table}`)
      .join(", ");
    console.log(`db:seed: seeded ${counts}`);
    for (const r of result.reports) console.log(`db:seed: wrote ${r.file} (sha256 ${r.sha256})`);
    console.log(`seed checksum: ${result.checksum}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${name} failed: ${message.replaceAll(connectionString, "[connection string]")}`);
    process.exit(1);
  }
}

void main();
