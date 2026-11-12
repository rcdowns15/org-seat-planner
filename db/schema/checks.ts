import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// Enum-like columns are `text` + a CHECK constraint, not Postgres enum types, everywhere in this
// repo. Why: a bad value is a clean check_violation (SQLSTATE 23514) that names the constraint;
// adding a value is a one-line constraint swap in a migration (no ALTER TYPE rules); and dbt
// reads plain text, so its `accepted_values` tests mirror the same lists.

// Renders `<column> in ('a', 'b')` for a CHECK constraint. The values are compile-time constants
// from db/schema, never input, so inlining them with sql.raw is safe (DDL can't take bind
// parameters anyway).
export function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;
}
