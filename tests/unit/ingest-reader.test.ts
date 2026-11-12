import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CsvFileReader } from "../../scripts/ingest/reader";

function fileWith(bytes: Buffer): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "reader-test-")), "worker_report.csv");
  writeFileSync(file, bytes);
  return file;
}

describe("CsvFileReader", () => {
  it("turns invalid UTF-8 into a parse error instead of replacement characters", async () => {
    // 0xE9 alone is Latin-1 "é", not valid UTF-8.
    const source = await new CsvFileReader(
      fileWith(Buffer.from([...Buffer.from("a,b\n1,Se"), 0xe9, ...Buffer.from("n\n")])),
    ).read();
    expect(source.parseError).toMatch(/not valid UTF-8/);
    expect(source.records).toEqual([]);
  });

  it("reads a BOM-prefixed UTF-8 file", async () => {
    const source = await new CsvFileReader(
      fileWith(Buffer.from("\uFEFFa,b\n1,Seán\n", "utf8")),
    ).read();
    expect(source.parseError).toBeNull();
    expect(source.records).toEqual([
      ["a", "b"],
      ["1", "Seán"],
    ]);
  });
});
