import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = 'getaddrinfo ENOTFOUND secret-host password authentication failed for user "bob"';

vi.mock("@/server/db", () => ({
  getPool: () => ({ connect: () => Promise.reject(new Error(SECRET)) }),
}));

import { getUnderTheHood } from "@/server/queries/under-the-hood";

afterEach(() => vi.restoreAllMocks());

describe("getUnderTheHood when the database is unreachable", () => {
  it("returns a generic failure in every section and logs the detail server-side", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sections } = await getUnderTheHood({ seatId: null, groupId: null });
    expect(sections).toHaveLength(8);
    for (const s of sections) {
      expect(s.result).toMatchObject({
        ok: false,
        code: "QUERY_ERROR",
        message: "Database unavailable.",
      });
      expect(JSON.stringify(s.result)).not.toContain("secret-host");
    }
    expect(log).toHaveBeenCalled();
  });
});
