import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Same precedence as Next and the scripts: .env.local, then .env. Variables already set win.
config({ path: [".env.local", ".env"], quiet: true });

// `pnpm db:generate` diffs db/schema against the last snapshot and needs no database.
// Commands that connect (e.g. `drizzle-kit studio`) use the direct connection (D-007).
// `pnpm db:migrate` doesn't read this file: it runs scripts/db/migrate.ts on the same folder.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/*.ts",
  out: "./db/migrations",
  schemaFilter: ["app", "workday"],
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
