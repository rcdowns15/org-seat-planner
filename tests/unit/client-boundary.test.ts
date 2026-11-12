import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = path.resolve(__dirname, "../../src");
const forbidden = /from\s+["'](@\/server\/[^"']*|pg|drizzle-orm[^"']*|server-only)["']/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

describe("server/client boundary", () => {
  it("no 'use client' file imports src/server, pg or drizzle-orm", () => {
    const offenders = sourceFiles(srcDir).filter((file) => {
      const text = readFileSync(file, "utf8");
      return /^\s*["']use client["']/m.test(text) && forbidden.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("src/server/db.ts starts with import 'server-only'", () => {
    const text = readFileSync(path.join(srcDir, "server/db.ts"), "utf8");
    expect(text.trimStart().startsWith('import "server-only";')).toBe(true);
  });
});
