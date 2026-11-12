import { describe, expect, it } from "vitest";
import { CsvSyntaxError, parseReportCsv } from "../../scripts/ingest/parse-csv";
import {
  REPORT_COLUMNS,
  reportDateFromFileName,
  validateReport,
} from "../../scripts/ingest/validate";

const FILE = "worker_report_2026-11-15.csv";

// One valid report row, in column order; tests override single cells by column name.
function row(overrides: Partial<Record<(typeof REPORT_COLUMNS)[number], string>> = {}): string[] {
  const base: Record<(typeof REPORT_COLUMNS)[number], string> = {
    Worker_ID: "104217",
    Worker_Name: "Hale, Ada",
    Work_Email: "ada.hale@example.com",
    Worker_Type: "Employee",
    Worker_Status: "Active",
    Hire_Date: "03/15/2022",
    Termination_Date: "",
    Contract_End_Date: "",
    Manager_ID: "100001",
    Job_Title: "Software Engineer",
    Supervisory_Organization: "Payments (Rui Chen)",
    Position_ID: "P-0001",
    Cost_Center: "CC-1010",
    Location: "Remote",
    ...overrides,
  };
  return REPORT_COLUMNS.map((c) => base[c]);
}

const header = [...REPORT_COLUMNS] as string[];
const validate = (...rows: string[][]) => validateReport(FILE, [header, ...rows]);

function reasonsOf(result: ReturnType<typeof validate>): string[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.reasons;
}

describe("validateReport accepts", () => {
  it("a clean file, a future hire date and blank optional dates", () => {
    const result = validate(
      row(),
      row({
        Worker_ID: "C-04512",
        Worker_Type: "Contingent Worker",
        Contract_End_Date: "01/31/2027",
      }),
      row({ Worker_ID: "104218", Hire_Date: "12/01/2026" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.reportDate).toBe("2026-11-15");
      expect(result.report.rows).toHaveLength(3);
    }
  });

  it("columns in any order, and keeps cell text untrimmed", () => {
    const reversed = [...header].reverse();
    const cells = [...row({ Job_Title: "  Engineer " })].reverse();
    const result = validateReport(FILE, [reversed, cells]);
    expect(result.ok && result.report.rows[0].Job_Title).toBe("  Engineer ");
  });
});

describe("validateReport rejects the whole file, naming row and column", () => {
  it("a duplicate Worker_ID", () => {
    const reasons = reasonsOf(validate(row(), row()));
    expect(reasons).toEqual([expect.stringMatching(/row 2, column Worker_ID: duplicates row 1/)]);
  });

  it("a missing column", () => {
    const result = validateReport(FILE, [
      header.filter((c) => c !== "Hire_Date"),
      row().filter((_, i) => header[i] !== "Hire_Date"),
    ]);
    expect(reasonsOf(result)).toEqual(["header: required column Hire_Date is missing"]);
  });

  it("a bad date, including an impossible calendar date", () => {
    expect(reasonsOf(validate(row({ Hire_Date: "2022-03-15" })))[0]).toMatch(
      /row 1, column Hire_Date/,
    );
    expect(
      reasonsOf(validate(row(), row({ Worker_ID: "104218", Hire_Date: "02/30/2022" })))[0],
    ).toMatch(/row 2, column Hire_Date/);
    expect(reasonsOf(validate(row({ Contract_End_Date: "soon" })))[0]).toMatch(
      /row 1, column Contract_End_Date/,
    );
  });

  it("an unknown status or worker type", () => {
    expect(reasonsOf(validate(row({ Worker_Status: "Retired" })))[0]).toMatch(
      /row 1, column Worker_Status/,
    );
    expect(reasonsOf(validate(row({ Worker_Type: "Intern" })))[0]).toMatch(
      /row 1, column Worker_Type/,
    );
  });

  it("a Worker_ID whose format contradicts its Worker_Type", () => {
    expect(reasonsOf(validate(row({ Worker_ID: "C-04512" })))[0]).toMatch(
      /row 1, column Worker_ID: an Employee ID must be six digits/,
    );
    expect(
      reasonsOf(validate(row({ Worker_Type: "Contingent Worker", Worker_ID: "104217" })))[0],
    ).toMatch(/row 1, column Worker_ID: a Contingent Worker ID must be C- plus five digits/);
  });

  it("an empty Worker_ID and a termination date after the report date", () => {
    expect(reasonsOf(validate(row({ Worker_ID: "" })))[0]).toMatch(
      /row 1, column Worker_ID: is empty/,
    );
    expect(
      reasonsOf(validate(row({ Worker_Status: "Terminated", Termination_Date: "11/16/2026" })))[0],
    ).toMatch(/row 1, column Termination_Date: is after the report date 2026-11-15/);
  });

  it("a wrong field count, a bad file name and a file with no rows", () => {
    expect(reasonsOf(validate(row().slice(1)))[0]).toMatch(
      /row 1: has 13 fields but the header has 14/,
    );
    const badName = validateReport("report.csv", [header, row()]);
    expect(reasonsOf(badName)[0]).toMatch(/file name/);
    expect(reasonsOf(validate())[0]).toMatch(/no data rows/);
  });

  it("collects every problem, not just the first", () => {
    const reasons = reasonsOf(
      validate(row({ Worker_Status: "x" }), row({ Worker_ID: "104218", Hire_Date: "bad" })),
    );
    expect(reasons).toHaveLength(2);
  });
});

describe("reportDateFromFileName", () => {
  it("reads a real date and nothing else", () => {
    expect(reportDateFromFileName("worker_report_2026-11-01.csv")).toBe("2026-11-01");
    expect(reportDateFromFileName("worker_report_2026-02-30.csv")).toBeNull();
    expect(reportDateFromFileName("worker_report_2026-11-01.txt")).toBeNull();
  });
});

describe("parseReportCsv", () => {
  it("parses a BOM-prefixed, CRLF file with quoted names byte for byte", () => {
    const text =
      "﻿Worker_ID,Worker_Name,Job_Title\r\n" +
      '104217,"O\'Brien, Seán",Engineer\r\n' +
      '104218,"Müller, ""Jo"" Anne"," padded  "\r\n' +
      "104219,Plain, \r\n";
    expect(parseReportCsv(text)).toEqual([
      ["Worker_ID", "Worker_Name", "Job_Title"],
      ["104217", "O'Brien, Seán", "Engineer"],
      ["104218", 'Müller, "Jo" Anne', " padded  "],
      ["104219", "Plain", " "],
    ]);
  });

  it("accepts LF endings, no final newline, empty trailing fields and a quoted line break", () => {
    expect(parseReportCsv('a,b,c\n1,,\n"x\r\ny",2,')).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
      ["x\r\ny", "2", ""],
    ]);
  });

  it("flags unbalanced or malformed quoting", () => {
    expect(() => parseReportCsv('a,b\n"open,1')).toThrow(CsvSyntaxError);
    expect(() => parseReportCsv('a,b\n"x"y,1')).toThrow(CsvSyntaxError);
    expect(() => parseReportCsv('a,b\nx"y,1')).toThrow(CsvSyntaxError);
  });
});
