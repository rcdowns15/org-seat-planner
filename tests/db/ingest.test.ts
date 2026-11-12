import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestReport } from "../../scripts/ingest/load";
import { CsvFileReader } from "../../scripts/ingest/reader";
import { parseCsv } from "../../scripts/seed/csv";
import { runSeed } from "../../scripts/seed/run-seed";
import { getPool } from "@/server/db";

const url = () => process.env.DATABASE_URL!;
const ingest = (file: string) => ingestReport(getPool(), new CsvFileReader(file));

async function rows<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await getPool().query(text, values)).rows as T[];
}
async function count(table: string, where = "true"): Promise<number> {
  return Number((await rows<{ n: string }>(`select count(*) n from ${table} where ${where}`))[0].n);
}

const clearWorkday = () =>
  getPool().query(
    "truncate workday.workers, workday.raw_worker_report, workday.ingest_runs restart identity",
  );

let dir: string;
let report1: string;
let report2: string;
let ids1: string[];
let ids2: string[];

// Ids of the data rows in a report file, read with the seed's parser: the test's expectations
// come from the file, not from the ingest code under test.
const idsOf = (file: string) =>
  parseCsv(readFileSync(file, "utf8"))
    .slice(1)
    .map((r) => r[0]);

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ingest-test-"));
  await runSeed(url(), dir);
  report1 = path.join(dir, "worker_report_2026-11-01.csv");
  report2 = path.join(dir, "worker_report_2026-11-15.csv");
  ids1 = idsOf(report1);
  ids2 = idsOf(report2);
}, 60_000);

afterAll(async () => {
  // Leave the database seeded for whichever test file runs next.
  await runSeed(url());
}, 60_000);

describe("ingesting the two mock reports", () => {
  it("loads 11-01 then 11-15 with the expected raw and current counts", async () => {
    await clearWorkday();
    const a = await ingest(report1);
    expect(a).toMatchObject({ status: "loaded", reportDate: "2026-11-01", rowCount: ids1.length });
    expect(await count("workday.raw_worker_report")).toBe(ids1.length);
    expect(await count("workday.workers")).toBe(ids1.length);

    const b = await ingest(report2);
    expect(b).toMatchObject({ status: "loaded", reportDate: "2026-11-15", rowCount: ids2.length });
    // Raw keeps both reports in full.
    expect(await count("workday.raw_worker_report", "report_date = '2026-11-01'")).toBe(
      ids1.length,
    );
    expect(await count("workday.raw_worker_report", "report_date = '2026-11-15'")).toBe(
      ids2.length,
    );
    // Current is the union: a worker missing from 11-15 is kept (an exception, not a deletion).
    const union = new Set([...ids1, ...ids2]);
    expect(await count("workday.workers")).toBe(union.size);
    const missing = ids1.filter((id) => !ids2.includes(id));
    expect(missing.length).toBeGreaterThan(0);
    const stale = await rows<{ as_of_report_date: string }>(
      "select as_of_report_date::text from workday.workers where worker_id = $1",
      [missing[0]],
    );
    expect(stale[0].as_of_report_date).toBe("2026-11-01");
    expect(await count("workday.workers", "as_of_report_date = '2026-11-15'")).toBe(ids2.length);
    expect(await rows("select status, count(*) from workday.ingest_runs group by status")).toEqual([
      { status: "loaded", count: "2" },
    ]);
  });

  it("keeps raw rows as the file had them, and types the current table", async () => {
    // The seed pads some names, job titles and locations with spaces; raw keeps them.
    const padded = (column: string) =>
      count("workday.raw_worker_report", `${column} <> trim(${column})`);
    expect(await padded("worker_name")).toBeGreaterThan(0);
    expect(await padded("job_title")).toBeGreaterThan(0);
    expect(await count("workday.workers", "job_title <> trim(job_title)")).toBe(0);
    const r = await rows<{ hire_date: string }>(
      "select hire_date from workday.raw_worker_report where report_date = '2026-11-15' limit 1",
    );
    expect(r[0].hire_date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("re-ingesting the same file changes nothing and records a skipped run", async () => {
    const before = await rows("select * from workday.workers order by worker_id");
    const rawBefore = await count("workday.raw_worker_report");
    const again = await ingest(report2);
    expect(again.status).toBe("skipped");
    expect(await count("workday.raw_worker_report")).toBe(rawBefore);
    expect(await rows("select * from workday.workers order by worker_id")).toEqual(before);
    const runs = await rows<{ status: string }>(
      "select status from workday.ingest_runs order by run_id",
    );
    expect(runs.map((r) => r.status)).toEqual(["loaded", "loaded", "skipped"]);
  });

  it("rejects a bad file, loads nothing and leaves the previous report current", async () => {
    // The 11-15 file with a bad hire date in its first data row, under a new name and hash.
    const lines = readFileSync(report2, "utf8").split("\r\n");
    // The first MM/DD/YYYY in a row is its Hire_Date.
    lines[1] = lines[1].replace(/\d\d\/\d\d\/\d{4}/, "13/45/2026");
    const bad = path.join(dir, "worker_report_2026-11-29.csv");
    writeFileSync(bad, lines.join("\r\n"));

    const rawBefore = await count("workday.raw_worker_report");
    const workersBefore = await rows("select * from workday.workers order by worker_id");
    const result = await ingest(bad);
    expect(result.status).toBe("rejected");
    expect(result.reasons[0]).toMatch(/row 1, column Hire_Date/);
    expect(await count("workday.raw_worker_report")).toBe(rawBefore);
    expect(await rows("select * from workday.workers order by worker_id")).toEqual(workersBefore);
    const run = await rows<{ status: string; rejection_reasons: string[] }>(
      "select status, rejection_reasons from workday.ingest_runs order by run_id desc limit 1",
    );
    expect(run[0].status).toBe("rejected");
    expect(run[0].rejection_reasons[0]).toMatch(/Hire_Date/);
  });

  it("rejects a report that is not newer than the loaded one", async () => {
    const older = path.join(dir, "worker_report_2026-11-10.csv");
    writeFileSync(older, readFileSync(report1, "utf8") + "\r\n"); // new hash, same rows
    const result = await ingest(older);
    expect(result.status).toBe("rejected");
    expect(result.reasons[0]).toMatch(/not newer/);
  });
});

describe("the seed loads Workday through ingest", () => {
  it("leaves one loaded run and the 11-01 raw rows, and survives a second seed", async () => {
    const first = await runSeed(url(), dir);
    const second = await runSeed(url(), dir);
    expect(second.checksum).toBe(first.checksum);
    expect(
      await rows("select status, report_date::text d, row_count from workday.ingest_runs"),
    ).toEqual([{ status: "loaded", d: "2026-11-01", row_count: ids1.length }]);
    expect(await count("workday.raw_worker_report")).toBe(ids1.length);
  }, 60_000);
});
