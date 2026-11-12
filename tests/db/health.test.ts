import { beforeAll, describe, expect, it } from "vitest";
import { generateSeedData } from "../../scripts/seed/generate";
import { runSeed } from "../../scripts/seed/run-seed";
import { getPool } from "@/server/db";
import { checkDatabase } from "@/server/health";

describe("health check against the seeded database", () => {
  beforeAll(async () => {
    await runSeed(process.env.DATABASE_URL!);
  });

  it("reports the same seat count as app.seats and as the seed generator", async () => {
    const { rows } = await getPool().query<{ n: string }>("select count(*) as n from app.seats");
    const inDb = Number(rows[0].n);
    const result = await checkDatabase();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, db: "ok", seats: inDb });
    expect(inDb).toBe(generateSeedData().seats.length);
    expect(inDb).toBeGreaterThan(2000); // seed README: "about 2,200 seats"
  });
});
