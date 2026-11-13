import { describe, expect, it } from "vitest";
import {
  PRESET_KEYS,
  runPreset,
  toFailure,
  type PresetKey,
  type QueryResult,
} from "@/server/queries/under-the-hood";

const ANALYTICS_PRESETS: PresetKey[] = [
  "reconciliation_exceptions",
  "workday_changes",
  "squad_headcount_vs_plan",
];
const IDS = { seatId: null, groupId: null };

describe("analytics presets when the analytics schema is empty or missing", () => {
  it('flags Postgres "undefined table" and "invalid schema" as missing', () => {
    expect(toFailure({ code: "42P01", message: 'relation "analytics.x" does not exist' })).toEqual({
      ok: false,
      code: "QUERY_ERROR",
      missing: true,
      message: "Table or schema not found.",
    });
    expect(toFailure({ code: "3F000" })).toMatchObject({ code: "QUERY_ERROR", missing: true });
  });

  it.each(ANALYTICS_PRESETS)(
    "%s shows a friendly build message, not a database error",
    async (key) => {
      const missing: QueryResult = toFailure({ code: "42P01", message: "relation does not exist" });
      const section = await runPreset(key, IDS, async () => missing);
      expect(section.result).toBeNull();
      expect(section.empty).toMatch(/aren't built yet/);
      expect(section.empty).toMatch(/pnpm run pipeline/);
      expect(section.empty).not.toMatch(/relation/);
    },
  );

  it.each(ANALYTICS_PRESETS)(
    "%s shows its empty message when the table has no rows",
    async (key) => {
      const noRows: QueryResult = { ok: true, columns: ["a"], rows: [], truncated: false };
      const section = await runPreset(key, IDS, async () => noRows);
      expect(section.empty).not.toBeNull();
      expect(section.empty).not.toMatch(/aren't built yet/);
    },
  );

  it("a missing table in a non-analytics preset stays an error", async () => {
    const missing: QueryResult = toFailure({ code: "42P01" });
    const section = await runPreset("recent_changes", IDS, async () => missing);
    expect(section.empty).toBeNull();
    expect(section.result).toMatchObject({ ok: false, code: "QUERY_ERROR", missing: true });
  });

  it("the three analytics presets are registered", () => {
    for (const key of ANALYTICS_PRESETS) expect(PRESET_KEYS).toContain(key);
  });
});
