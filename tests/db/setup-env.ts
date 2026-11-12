import { requireLocalDatabaseUrl } from "./local-db";

// Runs in every db test file's worker before its tests: sets DATABASE_URL (local only).
requireLocalDatabaseUrl();
