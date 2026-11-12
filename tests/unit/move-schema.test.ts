import { describe, expect, it } from "vitest";
import { MOVE_FAILURE_CODES, moveInputSchema } from "@/lib/schemas/move";

const valid = {
  workerId: "100041",
  fromSeatId: 27,
  toSeatId: 26,
  effectiveDate: "2026-11-20",
  fromSeatVersion: 0,
  toSeatVersion: 3,
};

describe("moveInputSchema", () => {
  it("accepts a valid move, including a contingent worker id", () => {
    expect(moveInputSchema.parse(valid)).toEqual(valid);
    expect(moveInputSchema.safeParse({ ...valid, workerId: "C-00021" }).success).toBe(true);
  });

  it("strips a spoofed leader id: mutations never take one from input", () => {
    const parsed = moveInputSchema.parse({ ...valid, leaderId: 1, actorLeaderId: 1 });
    expect(parsed).toEqual(valid);
    expect("leaderId" in parsed).toBe(false);
  });

  it.each([
    ["missing workerId", { workerId: undefined }],
    ["empty workerId", { workerId: "" }],
    ["workerId with spaces or SQL", { workerId: "1 OR 1=1" }],
    ["workerId too long", { workerId: "1".repeat(33) }],
    ["seat id as string", { fromSeatId: "27" }],
    ["seat id zero", { toSeatId: 0 }],
    ["negative seat id", { toSeatId: -5 }],
    ["fractional seat id", { fromSeatId: 1.5 }],
    ["seat id over Postgres integer", { toSeatId: 2_147_483_648 }],
    ["negative version", { fromSeatVersion: -1 }],
    ["fractional version", { toSeatVersion: 0.5 }],
    ["missing version", { toSeatVersion: undefined }],
    ["US date format", { effectiveDate: "11/20/2026" }],
    ["impossible date", { effectiveDate: "2026-02-30" }],
    ["timestamp instead of date", { effectiveDate: "2026-11-20T00:00:00Z" }],
    ["missing date", { effectiveDate: undefined }],
  ])("rejects %s", (_label, override) => {
    expect(moveInputSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it("rejects non-objects", () => {
    for (const input of [null, undefined, "move", 42, []]) {
      expect(moveInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("leaves the date window to the service: any real date parses", () => {
    // Backdated and far-future dates are INVALID_EFFECTIVE_DATE (a business rule), not input errors.
    expect(moveInputSchema.safeParse({ ...valid, effectiveDate: "2020-01-01" }).success).toBe(true);
    expect(moveInputSchema.safeParse({ ...valid, effectiveDate: "2030-01-01" }).success).toBe(true);
  });

  it("lists the failure codes in check order", () => {
    expect(MOVE_FAILURE_CODES).toEqual([
      "INVALID_INPUT",
      "READ_ONLY",
      "FORBIDDEN",
      "WORKER_NOT_ACTIVE",
      "NOT_IN_SEAT",
      "SEAT_NOT_AVAILABLE",
      "SEAT_TYPE_MISMATCH",
      "INVALID_EFFECTIVE_DATE",
      "CONFLICT",
    ]);
  });
});
