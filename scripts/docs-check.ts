// `pnpm docs:check`: every `path:line` code reference in README.md and docs/explainers/*.md must
// point to a file that exists and a line inside it. Exit code 1 lists each broken reference with
// the doc file and line it's on. The rule for what counts as a reference is in
// scripts/docs/references.ts. Run from the repo root.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkDocs, findReferences, lineCountsFrom } from "./docs/references";

const root = process.cwd();
const explainersDir = "docs/explainers";

const docFiles = ["README.md"];
if (existsSync(path.join(root, explainersDir))) {
  for (const name of readdirSync(path.join(root, explainersDir)).sort()) {
    if (name.endsWith(".md")) docFiles.push(`${explainersDir}/${name}`);
  }
}

const docs = docFiles.map((file) => ({
  file,
  text: readFileSync(path.join(root, file), "utf8"),
}));
const referenceCount = docs.reduce((n, doc) => n + findReferences(doc.text).length, 0);
const problems = checkDocs(docs, lineCountsFrom(root));

if (problems.length > 0) {
  console.error(`docs:check: ${problems.length} broken reference(s):`);
  for (const p of problems) {
    console.error(`  ${p.docFile}:${p.docLine}: \`${p.reference}\`: ${p.reason}`);
  }
  process.exitCode = 1;
} else {
  console.log(`docs:check: ${referenceCount} references in ${docs.length} files, all resolve.`);
}
