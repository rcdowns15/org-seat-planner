import { afterAll, describe, expect, it } from "vitest";
import { getPool } from "@/server/db";
import { checkDatabase } from "@/server/health";

describe("local database", () => {
  afterAll(async () => {
    await getPool().end();
  });

  it("answers select 1", async () => {
    const res = await getPool().query("select 1 as one");
    expect(res.rows[0].one).toBe(1);
  });

  it("has the app, workday and analytics schemas", async () => {
    const res = await getPool().query<{ schema_name: string }>(
      "select schema_name from information_schema.schemata where schema_name = any($1)",
      [["app", "workday", "analytics"]],
    );
    expect(res.rows.map((r) => r.schema_name).sort()).toEqual(["analytics", "app", "workday"]);
  });

  it("pool has an error listener so a dropped idle connection can't crash the process", () => {
    expect(getPool().listenerCount("error")).toBeGreaterThan(0);
  });

  it("health check reports ok", async () => {
    const result = await checkDatabase();
    expect(result.status).toBe(200);
    expect(result.body.db).toBe("ok");
  });
});
