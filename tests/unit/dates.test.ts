import { describe, expect, it } from "vitest";
import { addUtcDays, utcToday } from "@/lib/dates";

describe("utc dates", () => {
  it("utcToday is the UTC calendar date, not the local one", () => {
    expect(utcToday(new Date("2026-11-13T23:30:00Z"))).toBe("2026-11-13");
    expect(utcToday(new Date("2026-11-14T00:30:00Z"))).toBe("2026-11-14");
  });
  it("addUtcDays crosses month and year ends", () => {
    expect(addUtcDays("2026-11-13", 90)).toBe("2027-02-11");
    expect(addUtcDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
