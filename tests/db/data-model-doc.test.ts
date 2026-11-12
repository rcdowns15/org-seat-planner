import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getPool } from "@/server/db";

// Keeps docs/data-model.md in sync with the migrated database: every table and column in the
// `app` and `workday` schemas must be documented, and the doc must not list anything that
// doesn't exist. Runs after the global setup has applied all migrations.

const DOC_PATH = path.resolve(__dirname, "../../docs/data-model.md");

// Parses "### `schema.table`" sections and the "| `column` | ..." rows of each section's table.
function documentedColumns(markdown: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^###\s+`(\w+\.\w+)`\s*$/);
    if (heading) {
      current = heading[1];
      tables.set(current, []);
      continue;
    }
    if (line.startsWith("#")) {
      current = null;
      continue;
    }
    const row = line.match(/^\|\s*`(\w+)`\s*\|/);
    if (current && row) tables.get(current)!.push(row[1]);
  }
  return tables;
}

async function actualColumns(): Promise<Map<string, string[]>> {
  const res = await getPool().query<{ table_name: string; column_name: string }>(
    `select c.table_schema || '.' || c.table_name as table_name, c.column_name
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = any($1) and t.table_type = 'BASE TABLE'
      order by c.table_schema, c.table_name, c.ordinal_position`,
    [["app", "workday"]],
  );
  const tables = new Map<string, string[]>();
  for (const { table_name, column_name } of res.rows) {
    tables.set(table_name, [...(tables.get(table_name) ?? []), column_name]);
  }
  return tables;
}

describe("docs/data-model.md matches the migrated schema", () => {
  const markdown = readFileSync(DOC_PATH, "utf8");

  afterAll(async () => {
    await getPool().end();
  });

  it("documents exactly the tables in app and workday", async () => {
    const actual = await actualColumns();
    expect([...documentedColumns(markdown).keys()].sort()).toEqual([...actual.keys()].sort());
  });

  it("documents exactly the columns of each table", async () => {
    const documented = documentedColumns(markdown);
    for (const [table, columns] of await actualColumns()) {
      expect(documented.get(table)?.slice().sort(), table).toEqual(columns.slice().sort());
    }
  });

  it("has a one-line summary per table and a Mermaid ER diagram", async () => {
    for (const table of (await actualColumns()).keys()) {
      const summaryRow = new RegExp(`^\\| \`${table.replace(".", "\\.")}\` \\| .+\\|\\r?$`, "m");
      expect(markdown, table).toMatch(summaryRow);
    }
    expect(markdown).toMatch(/```mermaid\r?\nerDiagram/);
  });
});
