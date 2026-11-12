import { describe, expect, it } from "vitest";
import { SEAT_STATUSES, formatSeatStatus } from "@/lib/seat-status";

describe("formatSeatStatus", () => {
  it("returns a human label for every seat status", () => {
    expect(formatSeatStatus("filled")).toBe("Filled");
    expect(formatSeatStatus("open")).toBe("Open");
    expect(formatSeatStatus("backfill")).toBe("Backfill");
    expect(formatSeatStatus("offer_accepted")).toBe("Offer accepted");
  });

  it("has a distinct non-empty label for each status in SEAT_STATUSES", () => {
    const labels = SEAT_STATUSES.map(formatSeatStatus);
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(SEAT_STATUSES.length);
  });
});
