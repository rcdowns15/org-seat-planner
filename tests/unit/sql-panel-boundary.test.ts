import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// D-026: the panel runs preset queries only. runReadOnlyQuery takes SQL text, so it may be
// imported only by the file that holds the presets.
const ALLOWED = ["src", "server", "queries", "under-the-hood.ts"].join(sep);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

describe("D-026 guard", () => {
  it("no file outside under-the-hood.ts uses runReadOnlyQuery", () => {
    const root = process.cwd();
    const offenders = files(join(root, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => relative(root, f))
      .filter((f) => f !== ALLOWED)
      .filter((f) => readFileSync(join(root, f), "utf8").includes("runReadOnlyQuery"));
    expect(offenders).toEqual([]);
  });
});
