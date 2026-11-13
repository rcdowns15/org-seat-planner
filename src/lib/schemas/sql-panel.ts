import { z } from "zod";

// What the "Under the hood" panel accepts: typed IDs only, never SQL (D-026). The panel's presets
// are fixed in src/server/queries/under-the-hood.ts; these are the values bound into them.
const id = z.number().int().positive().max(2_147_483_647);

export const panelParamsSchema = z.object({
  seatId: id.nullable(),
  groupId: id.nullable(),
});

export type PanelParams = z.infer<typeof panelParamsSchema>;

// ?seat=<id> in the URL: a positive integer, or absent. Anything else counts as no selection.
export function parseSeatParam(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,8}$/.test(value)) return null;
  return Number(value);
}
