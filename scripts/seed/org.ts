import type { Faker } from "@faker-js/faker";
import { SQUADS_PER_GROUP } from "./config";
import { DIVISION_NAMES, GROUP_NAMES, SQUAD_NOUNS, SQUAD_WORDS } from "./names";

export type OrgDivision = { name: string };
export type OrgGroup = { name: string; divisionIndex: number; costCenter: string };
export type OrgSquad = { name: string; groupIndex: number };
export type Org = { divisions: OrgDivision[]; groups: OrgGroup[]; squads: OrgSquad[] };

// 4 divisions x 3 groups x 15 squads = 12 groups and 180 squads. Database ids are the array
// index + 1 (the seed inserts in this order into freshly reset identity columns).
export function buildOrg(faker: Faker): Org {
  const divisions = DIVISION_NAMES.map((name) => ({ name }));
  const groups: OrgGroup[] = [];
  GROUP_NAMES.forEach((names, divisionIndex) => {
    names.forEach((name) => {
      // One cost center per group, Workday-style: "CC-1010 Digital Channels".
      groups.push({ name, divisionIndex, costCenter: `CC-${1010 + groups.length * 10} ${name}` });
    });
  });

  // Squad names: shuffled "<Word> <Noun>" pairs, so every squad name is unique across the org.
  const pairs = SQUAD_WORDS.flatMap((word) => SQUAD_NOUNS.map((noun) => `${word} ${noun}`));
  const names = faker.helpers.shuffle(pairs);
  const squads: OrgSquad[] = [];
  groups.forEach((_, groupIndex) => {
    for (let i = 0; i < SQUADS_PER_GROUP; i++) {
      squads.push({ name: names[squads.length], groupIndex });
    }
  });
  return { divisions, groups, squads };
}
