import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CsvSyntaxError, parseReportCsv } from "./parse-csv";

// What a reader hands to the loader: one report, parsed but not yet validated. An API reader
// would fill the same shape (name, a hash of the content, the table as rows of text).
export type ReportSource = {
  sourceFile: string;
  fileSha256: string;
  // Header first. Empty if the file couldn't be parsed; then `parseError` says why.
  records: string[][];
  parseError: string | null;
};

export interface ReportReader {
  read(): Promise<ReportSource>;
}

export class CsvFileReader implements ReportReader {
  constructor(private readonly file: string) {}

  async read(): Promise<ReportSource> {
    const bytes = await readFile(this.file);
    const fileSha256 = createHash("sha256").update(bytes).digest("hex");
    const sourceFile = path.basename(this.file);
    try {
      return {
        sourceFile,
        fileSha256,
        records: parseReportCsv(bytes.toString("utf8")),
        parseError: null,
      };
    } catch (err) {
      if (!(err instanceof CsvSyntaxError)) throw err;
      return { sourceFile, fileSha256, records: [], parseError: err.message };
    }
  }
}
