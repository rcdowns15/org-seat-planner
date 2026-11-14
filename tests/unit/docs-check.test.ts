import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkDocs,
  countLines,
  findReferences,
  lineCountsFrom,
} from "../../scripts/docs/references";

// A fake repo: one 3-line file. Missing files are null, like lineCountsFrom.
const files: Record<string, number> = { "src/server/services/moves.ts": 3, "package.json": 3 };
const lineCountOf = (p: string) => files[p] ?? null;

describe("findReferences: what counts as a code reference", () => {
  it("finds backticked path:line and path:start-end references, with their doc line", () => {
    const md = "Intro\nSee `src/server/services/moves.ts:2` and `src/a/b.ts:4-9`.\n";
    expect(findReferences(md)).toEqual([
      { path: "src/server/services/moves.ts", start: 2, end: 2, docLine: 2 },
      { path: "src/a/b.ts", start: 4, end: 9, docLine: 2 },
    ]);
  });

  it("accepts a root file with a known extension (no slash)", () => {
    expect(findReferences("`package.json:12`")).toHaveLength(1);
  });

  it("ignores URLs, host:port pairs, unbackticked text and fenced code blocks", () => {
    const md = [
      "Open `http://localhost:3000` or `https://example.test:443/x`.",
      "Postgres on `localhost:5432` or `127.0.0.1:5432`, or `example.test:443`.",
      "Plain text src/server/services/moves.ts:999 is not a reference.",
      "A sentence `with spaces src/x.ts:1` is not one either.",
      "```sh",
      "echo `src/server/services/moves.ts:999`",
      "```",
    ].join("\n");
    expect(findReferences(md)).toEqual([]);
  });
});

describe("checkDocs", () => {
  it("passes on references that resolve", () => {
    const docs = [{ file: "README.md", text: "`src/server/services/moves.ts:1-3` `package.json:3`" }];
    expect(checkDocs(docs, lineCountOf)).toEqual([]);
  });

  it("fails on a missing file, naming the doc file and line", () => {
    const docs = [{ file: "docs/explainers/x.md", text: "ok\n`src/nope.ts:1`" }];
    expect(checkDocs(docs, lineCountOf)).toEqual([
      {
        docFile: "docs/explainers/x.md",
        docLine: 2,
        reference: "src/nope.ts:1",
        reason: "file not found",
      },
    ]);
  });

  it("fails on a line past the end of the file, and on a range that runs past it", () => {
    const docs = [
      { file: "README.md", text: "`src/server/services/moves.ts:4`\n`package.json:2-4`" },
    ];
    const problems = checkDocs(docs, lineCountOf);
    expect(problems.map((p) => [p.docLine, p.reference, p.reason])).toEqual([
      [1, "src/server/services/moves.ts:4", "line 4 is past the end of the file (3 lines)"],
      [2, "package.json:2-4", "line 4 is past the end of the file (3 lines)"],
    ]);
  });

  it("fails on line 0 and on a backwards range", () => {
    const docs = [{ file: "README.md", text: "`package.json:0` `package.json:3-2`" }];
    expect(checkDocs(docs, lineCountOf).map((p) => p.reason)).toEqual([
      "line numbers start at 1",
      "range end 2 is before its start 3",
    ]);
  });
});

describe("line counts from disk", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "docs-check-"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src", "three.ts"), "a\nb\nc\n");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("counts lines without counting the final newline as a line", () => {
    expect(countLines("a\nb\nc\n")).toBe(3);
    expect(countLines("a\r\nb")).toBe(2);
    expect(countLines("")).toBe(0);
  });

  it("reads real files; a missing file or a directory is not found", () => {
    const counts = lineCountsFrom(root);
    expect(counts("src/three.ts")).toBe(3);
    expect(counts("src/missing.ts")).toBeNull();
    expect(counts("src")).toBeNull();
    const docs = [{ file: "README.md", text: "`src/three.ts:3` `src/three.ts:4`" }];
    expect(checkDocs(docs, counts).map((p) => p.reference)).toEqual(["src/three.ts:4"]);
  });
});
