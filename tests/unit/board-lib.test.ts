import { describe, expect, it } from "vitest";
import { defaultGroupIdForLeader, parseGroupParam, workerStatusLabel } from "@/lib/board";

describe("defaultGroupIdForLeader", () => {
  const groups = [
    { groupId: 5, name: "A", divisionId: 1, divisionName: "D1" },
    { groupId: 6, name: "B", divisionId: 1, divisionName: "D1" },
    { groupId: 7, name: "C", divisionId: 2, divisionName: "D2" },
  ];
  it("opens a group leader on their own group", () => {
    expect(
      defaultGroupIdForLeader({ scopeType: "group", divisionId: null, groupId: 6 }, groups),
    ).toBe(6);
  });
  it("opens a division leader on the first group of their division", () => {
    expect(
      defaultGroupIdForLeader({ scopeType: "division", divisionId: 2, groupId: null }, groups),
    ).toBe(7);
    expect(
      defaultGroupIdForLeader({ scopeType: "division", divisionId: 1, groupId: null }, groups),
    ).toBe(5);
  });
  it("returns null with no leader (the caller falls back to the demo group)", () => {
    expect(defaultGroupIdForLeader(null, groups)).toBeNull();
  });
});

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
