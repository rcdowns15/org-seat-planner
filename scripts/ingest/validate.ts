// Validates a whole Workday worker report before anything is loaded (D-028). Pure: no database.
// Every problem is collected, so one run shows everything wrong with the file. Messages name the
// row (1-based, after the header) and the column.

export const REPORT_COLUMNS = [
  "Worker_ID",
  "Worker_Name",
  "Work_Email",
  "Worker_Type",
  "Worker_Status",
  "Hire_Date",
  "Termination_Date",
  "Contract_End_Date",
  "Manager_ID",
  "Job_Title",
  "Supervisory_Organization",
  "Position_ID",
  "Cost_Center",
  "Location",
] as const;

export type ReportColumn = (typeof REPORT_COLUMNS)[number];
export type RawRow = Record<ReportColumn, string>;

export const WORKER_TYPE_TEXT = ["Employee", "Contingent Worker"] as const;
export const WORKER_STATUS_TEXT = ["Active", "On Leave", "Terminated"] as const;

// Columns that must hold text on every row (the typed current table needs them).
const REQUIRED_TEXT: ReportColumn[] = [
  "Worker_Name",
  "Work_Email",
  "Job_Title",
  "Supervisory_Organization",
  "Position_ID",
  "Cost_Center",
  "Location",
];

const FILE_NAME = /^worker_report_(\d{4}-\d{2}-\d{2})\.csv$/;

// Returns an ISO date (YYYY-MM-DD) for a real calendar date written MM/DD/YYYY, else null.
export function parseUsDate(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  return isoIfReal(Number(m[3]), Number(m[1]), Number(m[2]));
}

function isoIfReal(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  const real =
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  if (!real) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The report date from a file name like worker_report_2026-11-15.csv, or null.
export function reportDateFromFileName(fileName: string): string | null {
  const m = FILE_NAME.exec(fileName);
  if (!m) return null;
  const [y, mo, d] = m[1].split("-").map(Number);
  return isoIfReal(y, mo, d);
}

export type ValidatedReport = {
  reportDate: string;
  // The rows exactly as read (nothing trimmed), in file order.
  rows: RawRow[];
};

export type ValidationResult =
  { ok: true; report: ValidatedReport } | { ok: false; reasons: string[]; rowCount: number };

// `records` is the parsed file, header first.
export function validateReport(fileName: string, records: string[][]): ValidationResult {
  const reasons: string[] = [];
  const reportDate = reportDateFromFileName(fileName);
  if (reportDate === null) {
    reasons.push(
      `file name: "${fileName}" doesn't match worker_report_YYYY-MM-DD.csv with a real date`,
    );
  }

  const [header, ...body] = records;
  if (!header) {
    return { ok: false, reasons: [...reasons, "file: it is empty (no header row)"], rowCount: 0 };
  }
  const index = new Map<string, number>();
  header.forEach((name, i) => index.set(name.trim(), i));
  const missing = REPORT_COLUMNS.filter((c) => !index.has(c));
  for (const column of missing) reasons.push(`header: required column ${column} is missing`);
  if (missing.length > 0) return { ok: false, reasons, rowCount: body.length };
  if (body.length === 0) reasons.push("file: it has a header but no data rows");

  const rows: RawRow[] = [];
  const firstSeen = new Map<string, number>();
  body.forEach((cells, i) => {
    const n = i + 1;
    if (cells.length !== header.length) {
      reasons.push(`row ${n}: has ${cells.length} fields but the header has ${header.length}`);
      return;
    }
    const row = {} as RawRow;
    for (const column of REPORT_COLUMNS) row[column] = cells[index.get(column)!];
    rows.push(row);
    const fail = (column: ReportColumn, problem: string) =>
      reasons.push(`row ${n}, column ${column}: ${problem} (value "${row[column]}")`);

    const id = row.Worker_ID.trim();
    if (id === "") fail("Worker_ID", "is empty");
    else if (firstSeen.has(id)) fail("Worker_ID", `duplicates row ${firstSeen.get(id)}`);
    else firstSeen.set(id, n);

    const type = row.Worker_Type.trim();
    if (!(WORKER_TYPE_TEXT as readonly string[]).includes(type)) {
      fail("Worker_Type", `must be one of ${WORKER_TYPE_TEXT.join(", ")}`);
    } else if (id !== "") {
      if (type === "Employee" && !/^\d{6}$/.test(id)) {
        fail("Worker_ID", "an Employee ID must be six digits");
      } else if (type === "Contingent Worker" && !/^C-\d{5}$/.test(id)) {
        fail("Worker_ID", "a Contingent Worker ID must be C- plus five digits");
      }
    }

    const status = row.Worker_Status.trim();
    if (!(WORKER_STATUS_TEXT as readonly string[]).includes(status)) {
      fail("Worker_Status", `must be one of ${WORKER_STATUS_TEXT.join(", ")}`);
    }

    for (const column of REQUIRED_TEXT) {
      if (row[column].trim() === "") fail(column, "is empty");
    }
    // The typed table splits the name on the first comma into last and first name.
    if (row.Worker_Name.trim() !== "" && !/^[^,]+,[^,]*\S/.test(row.Worker_Name.trim())) {
      fail("Worker_Name", 'must look like "Last, First"');
    }

    const hire = row.Hire_Date.trim();
    if (parseUsDate(hire) === null) fail("Hire_Date", "must be a real date written MM/DD/YYYY");
    // Hire dates in the future are valid (a worker who has accepted an offer but not started).
    for (const column of ["Termination_Date", "Contract_End_Date"] as const) {
      const text = row[column].trim();
      if (text === "") continue;
      const iso = parseUsDate(text);
      if (iso === null) fail(column, "must be blank or a real date written MM/DD/YYYY");
      else if (column === "Termination_Date" && reportDate !== null && iso > reportDate) {
        fail(column, `is after the report date ${reportDate}`);
      }
    }
  });

  if (reasons.length > 0) return { ok: false, reasons, rowCount: body.length };
  return { ok: true, report: { reportDate: reportDate!, rows } };
}
