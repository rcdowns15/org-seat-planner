// `pnpm workday:reports`: write the two mock Workday report CSVs to data/workday/ from the seed
// generator, without touching any database. The pipeline workflow uses it on a clean checkout so
// it never has to wipe and reseed Neon. The output is byte-identical to what `pnpm db:seed`
// writes (same generator, same seed), so the file hashes match and ingest stays idempotent.
import { generateSeedData } from "./seed/generate";
import { DEFAULT_REPORT_DIR } from "./seed/run-seed";
import { writeReportCsvs } from "./seed/write-report-csvs";

async function main(): Promise<void> {
  const data = generateSeedData();
  for (const r of await writeReportCsvs(data, DEFAULT_REPORT_DIR)) {
    console.log(`workday:reports: wrote ${r.file}`);
  }
}

void main();
