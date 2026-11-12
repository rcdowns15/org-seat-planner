import { describe, expect, it } from "vitest";
import { CARD_STATES, cardState, cardStateLabel } from "@/lib/seat-card";

describe("seat card states", () => {
  it("maps status and seat type to one of five states", () => {
    expect(cardState("filled", "employee")).toBe("filled_employee");
    expect(cardState("filled", "contingent")).toBe("filled_contingent");
    expect(cardState("open", "employee")).toBe("open");
    expect(cardState("backfill", "contingent")).toBe("backfill");
    expect(cardState("offer_accepted", "employee")).toBe("offer_accepted");
  });

  it("gives every state its own non-empty text label", () => {
    const labels = CARD_STATES.map(cardStateLabel);
    expect(new Set(labels).size).toBe(5);
    expect(labels.every((l) => l.length > 0)).toBe(true);
  });
});
