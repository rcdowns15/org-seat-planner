import { describe, expect, it } from "vitest";
import { checkDatabase } from "@/server/health";

describe("checkDatabase", () => {
  it("returns 503 / down when the DB call rejects, without throwing", async () => {
    const result = await checkDatabase(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(result).toEqual({ status: 503, body: { ok: false, db: "down", seats: null } });
  });

  it("returns 200 / ok with null seats before the schema exists", async () => {
    const result = await checkDatabase(() => Promise.resolve(null));
    expect(result).toEqual({ status: 200, body: { ok: true, db: "ok", seats: null } });
  });

  it("returns the seat count when available", async () => {
    const result = await checkDatabase(() => Promise.resolve(42));
    expect(result.body.seats).toBe(42);
  });
});
