// `pnpm workday:reports`: write the two mock Workday report CSVs to data/workday/ from the seed
// generator, without touching any database. The pipeline workflow uses it on a clean checkout so
// it never has to wipe and reseed Neon. The output is byte-identical to what `pnpm db:seed`
// writes (same generator, same seed), so the file hashes match and ingest stays idempotent.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NEXT_REPORT_DATE, SEED_DATE } from "./seed/config";
import { generateSeedData } from "./seed/generate";
import { DEFAULT_REPORT_DIR } from "./seed/run-seed";
import { buildReportCsv, reportFileName } from "./seed/workday-reports";

async function main(): Promise<void> {
  const data = generateSeedData();
  await mkdir(DEFAULT_REPORT_DIR, { recursive: true });
  for (const [date, list] of [
    [SEED_DATE, data.workers],
    [NEXT_REPORT_DATE, data.nextReportWorkers],
  ] as const) {
    const file = path.join(DEFAULT_REPORT_DIR, reportFileName(date));
    await writeFile(file, buildReportCsv(list), "utf8");
    console.log(`workday:reports: wrote ${file}`);
  }
}

void main();
