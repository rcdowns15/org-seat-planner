import { describe, expect, it } from "vitest";
import { parseGroupParam, workerStatusLabel } from "@/lib/board";

describe("parseGroupParam", () => {
  it("accepts absent and positive integers", () => {
    expect(parseGroupParam(undefined)).toBeNull();
    expect(parseGroupParam("7")).toBe(7);
  });
  it("rejects zero, text, negatives and repeated params", () => {
    for (const bad of ["abc", "0", "-1", "01", "1.5", ""]) {
      expect(parseGroupParam(bad)).toBe("invalid");
    }
    expect(parseGroupParam(["1", "2"])).toBe("invalid");
  });
});

describe("workerStatusLabel", () => {
  it("is readable", () => {
    expect(workerStatusLabel("leave")).toBe("On leave");
    expect(workerStatusLabel("terminated")).toBe("Terminated");
  });
});
