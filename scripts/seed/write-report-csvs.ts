import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NEXT_REPORT_DATE, SEED_DATE } from "./config";
import type { SeedData } from "./generate";
import { buildReportCsv, reportFileName } from "./workday-reports";

// Writes the two mock Workday report CSVs (11-01, then the 11-15 one) into `dir` and returns each
// file's path and sha256. Shared by `pnpm db:seed` and `pnpm workday:reports`, so both produce
// byte-identical files.
export async function writeReportCsvs(
  data: SeedData,
  dir: string,
): Promise<{ file: string; sha256: string }[]> {
  await mkdir(dir, { recursive: true });
  const reports: { file: string; sha256: string }[] = [];
  for (const [date, list] of [
    [SEED_DATE, data.workers],
    [NEXT_REPORT_DATE, data.nextReportWorkers],
  ] as const) {
    const csv = buildReportCsv(list);
    const file = path.join(dir, reportFileName(date));
    await writeFile(file, csv, "utf8");
    reports.push({ file, sha256: createHash("sha256").update(csv).digest("hex") });
  }
  return reports;
}
