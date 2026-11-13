import { readFileSync } from "node:fs";
import path from "node:path";

// Reads the tables in scripts/seed/README.md so tests can compare the documentation with the
// generated data: the doc and the code can't drift apart.
const README = path.resolve(__dirname, "../../scripts/seed/README.md");

function tableRows(section: string): string[][] {
  const text = readFileSync(README, "utf8");
  const start = text.indexOf(`\n## ${section}`);
  if (start === -1) throw new Error(`README section not found: ${section}`);
  const next = text.indexOf("\n## ", start + 1);
  const body = text.slice(start, next === -1 ? undefined : next);
  return body
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !cells.every((c) => /^-+$/.test(c)))
    .slice(1); // drop the header row
}

const unquote = (cell: string): string => cell.replace(/^`|`$/g, "");

export function documentedColumns(): { column: string; format: string; example: string }[] {
  return tableRows("Worker report layout").map((c) => ({
    column: unquote(c[1]),
    format: c[2],
    example: unquote(c[3]),
  }));
}

export function documentedSampleLines(): string[] {
  const text = readFileSync(README, "utf8");
  const match = /```csv\n([\s\S]*?)\n```/.exec(text);
  if (!match) throw new Error("README has no csv sample block");
  return match[1].split("\n");
}

export function documentedChanges(): { change: string; workerId: string; detail: string }[] {
  return tableRows("Changes in the 11-15 report").map((c) => ({
    change: c[0],
    workerId: c[1],
    detail: c[2],
  }));
}

export function documentedExceptions(): {
  exceptionType: string;
  subjectId: string;
  severity: string;
  seatId: number | null;
  groupName: string;
}[] {
  return tableRows("Reconciliation exceptions on the seed").map((c) => ({
    exceptionType: c[0],
    subjectId: c[1],
    severity: c[2],
    seatId: c[3] === "" ? null : Number(c[3]),
    groupName: c[4],
  }));
}

export function documentedFixtures(): Record<string, { key: string; value: string }> {
  return Object.fromEntries(
    tableRows("Named demo fixtures").map((c) => [
      unquote(c[0]),
      { key: unquote(c[1]), value: unquote(c[2]) },
    ]),
  );
}
