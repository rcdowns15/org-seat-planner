import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Code references in the docs (`pnpm docs:check`, LR-04-03).
//
// What counts as a reference: an inline code span (text between single backticks) whose whole
// content is `path:line` or `path:start-end`, where
//   - path is made of letters, digits and `_ . - /` only (so no spaces, no `:`), and
//   - path contains a `/` (e.g. `src/server/services/moves.ts:58`) or ends in one of the file
//     extensions below (e.g. `package.json:12`).
// Paths are relative to the repo root. Line numbers start at 1.
//
// What is not a reference, by that rule: URLs (`https://host:443` has a `:` inside the path part),
// host:port pairs like `localhost:3000` or `127.0.0.1:5432` (no `/`, no known extension), text
// that isn't in backticks, and anything inside a fenced code block (``` lines), where commands
// and SQL live.

export type Reference = {
  path: string;
  start: number;
  end: number; // equals start for a single line
  docLine: number; // the line of the markdown file the reference is on (1-based)
};

export type Problem = { docFile: string; docLine: number; reference: string; reason: string };

const KNOWN_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
  ".json",
  ".sql",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".py",
  ".csv",
];

const CODE_SPAN = /`([^`\n]+)`/g;
const PATH_LINE = /^([A-Za-z0-9_.\-/]+):(\d+)(?:-(\d+))?$/;

function looksLikeFilePath(p: string): boolean {
  return p.includes("/") || KNOWN_EXTENSIONS.some((ext) => p.endsWith(ext));
}

// Every reference in one markdown document, in order.
export function findReferences(markdown: string): Reference[] {
  const refs: Reference[] = [];
  let inFence = false;
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    for (const match of line.matchAll(CODE_SPAN)) {
      const parts = PATH_LINE.exec(match[1].trim());
      if (!parts || !looksLikeFilePath(parts[1])) continue;
      const start = Number(parts[2]);
      const end = parts[3] === undefined ? start : Number(parts[3]);
      refs.push({ path: parts[1], start, end, docLine: index + 1 });
    }
  });
  return refs;
}

// The number of lines in a file's text. A final newline ends the last line; it doesn't start one.
export function countLines(text: string): number {
  if (text === "") return 0;
  const lines = text.split(/\r?\n/);
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

// Why a reference is broken, or null when it's fine. `lineCountOf` returns the file's line count,
// or null when there is no such file (injected so this stays a pure function).
export function checkReference(
  ref: Reference,
  lineCountOf: (repoPath: string) => number | null,
): string | null {
  const lines = lineCountOf(ref.path);
  if (lines === null) return "file not found";
  if (ref.start < 1) return "line numbers start at 1";
  if (ref.end < ref.start) return `range end ${ref.end} is before its start ${ref.start}`;
  if (ref.end > lines) return `line ${ref.end} is past the end of the file (${lines} lines)`;
  return null;
}

// Every broken reference across the given documents.
export function checkDocs(
  docs: { file: string; text: string }[],
  lineCountOf: (repoPath: string) => number | null,
): Problem[] {
  const problems: Problem[] = [];
  for (const doc of docs) {
    for (const ref of findReferences(doc.text)) {
      const reason = checkReference(ref, lineCountOf);
      if (reason === null) continue;
      const range = ref.end === ref.start ? `${ref.start}` : `${ref.start}-${ref.end}`;
      problems.push({
        docFile: doc.file,
        docLine: ref.docLine,
        reference: `${ref.path}:${range}`,
        reason,
      });
    }
  }
  return problems;
}

// Reads line counts from disk under `root`. Directories and missing files count as not found.
export function lineCountsFrom(root: string): (repoPath: string) => number | null {
  return (repoPath) => {
    const full = path.join(root, repoPath);
    if (!existsSync(full) || !statSync(full).isFile()) return null;
    return countLines(readFileSync(full, "utf8"));
  };
}
