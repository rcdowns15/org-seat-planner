import "server-only";

// A small in-memory ring buffer of the SQL that recent saves ran, for the "Last save: SQL
// executed" panel (LR-02-08). Each entry is one save attempt (a move today; undo later): every
// statement its transaction sent, in order, as parameterized text plus the bound values, and how
// it ended. Failed attempts are kept too, so a CONFLICT shows the UPDATE that matched 0 rows.
//
// Limits, on purpose: it lives in this server process's memory, so it is empty after a restart
// and each serverless instance has its own. That is fine for a "what just happened" demo panel;
// the durable record of every change is app.seat_changes.

export type LoggedStatement = { sql: string; params: unknown[] };

export type SaveLogEntry = {
  action: "move";
  at: string; // ISO timestamp of when the save finished
  ok: boolean;
  code?: string; // the failure code when ok is false
  statements: LoggedStatement[];
};

export const SQL_LOG_CAPACITY = 20;

// Cached on globalThis so dev hot reloads keep one buffer (same reason as src/server/db.ts).
const globalForLog = globalThis as unknown as { __sqlLog?: SaveLogEntry[] };
function buffer(): SaveLogEntry[] {
  globalForLog.__sqlLog ??= [];
  return globalForLog.__sqlLog;
}

// Collects the statements of one transaction. Pass it as a Drizzle `logger`: Drizzle calls
// `logQuery` with the exact text and bound values of every statement it sends, including
// `begin`, `commit` and `rollback`.
export class StatementRecorder {
  readonly statements: LoggedStatement[] = [];
  logQuery(query: string, params: unknown[]): void {
    this.statements.push({ sql: query, params: [...params] });
  }
}

// Adds one save to the buffer, dropping the oldest when full.
export function recordSave(entry: Omit<SaveLogEntry, "at">): void {
  const log = buffer();
  log.push({ ...entry, at: new Date().toISOString() });
  if (log.length > SQL_LOG_CAPACITY) log.splice(0, log.length - SQL_LOG_CAPACITY);
}

// Newest first.
export function recentSaves(): SaveLogEntry[] {
  return [...buffer()].reverse();
}

// The most recent save attempt, or null if none since the server started.
export function lastSave(): SaveLogEntry | null {
  const log = buffer();
  return log.length > 0 ? log[log.length - 1] : null;
}

// For tests.
export function clearSqlLog(): void {
  buffer().length = 0;
}
