import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type DbHandle = { pool: Pool; db: NodePgDatabase };

// One pool per process. In dev, hot reloads re-evaluate modules, so the handle is cached on
// globalThis to avoid opening a new pool on every reload.
const globalForDb = globalThis as unknown as { __dbHandle?: DbHandle };

// Created on first use, never at import time, so `pnpm build` works without a database.
function getHandle(): DbHandle {
  if (globalForDb.__dbHandle) return globalForDb.__dbHandle;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local (see README: Local database).",
    );
  }
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000, // fail fast, but allow for a Neon cold start (can exceed 2 s)
    statement_timeout: 5000, // stop any single query running longer than 5 s
  });
  // Without a listener, a dropped idle connection (DB stopped, Neon suspend) crashes the process.
  pool.on("error", (err) => console.error("pg pool idle client error:", err.message));
  globalForDb.__dbHandle = { pool, db: drizzle(pool) };
  return globalForDb.__dbHandle;
}

export function getPool(): Pool {
  return getHandle().pool;
}

export function getDb(): NodePgDatabase {
  return getHandle().db;
}
