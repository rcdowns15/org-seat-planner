import { describe, expect, it } from "vitest";
import { canEditAnyGroup, type Leader } from "@/server/services/permissions";

const groups = [
  { groupId: 1, divisionId: 10 },
  { groupId: 2, divisionId: 10 },
  { groupId: 3, divisionId: 20 },
];

function leader(over: Partial<Leader>): Leader {
  return {
    leaderId: 1,
    workerId: "w",
    displayName: "L",
    scopeType: "group",
    divisionId: null,
    groupId: null,
    ...over,
  };
}

describe("canEditAnyGroup", () => {
  it("is false for no leader and for a leader whose scope matches no group", () => {
    expect(canEditAnyGroup(null, groups)).toBe(false);
    expect(canEditAnyGroup(leader({ groupId: 999 }), groups)).toBe(false);
    expect(canEditAnyGroup(leader({ scopeType: "division", divisionId: 999 }), groups)).toBe(false);
  });

  it("is true for a group leader of a listed group and a division leader of a listed division", () => {
    expect(canEditAnyGroup(leader({ groupId: 2 }), groups)).toBe(true);
    expect(canEditAnyGroup(leader({ scopeType: "division", divisionId: 20 }), groups)).toBe(true);
  });
});
