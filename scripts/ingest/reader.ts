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
    let text: string;
    try {
      // fatal: invalid UTF-8 is an error, not a silent U+FFFD. ignoreBOM keeps a leading BOM in
      // the text; the CSV parser strips it.
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return { sourceFile, fileSha256, records: [], parseError: "the file is not valid UTF-8" };
    }
    try {
      return { sourceFile, fileSha256, records: parseReportCsv(text), parseError: null };
    } catch (err) {
      if (!(err instanceof CsvSyntaxError)) throw err;
      return { sourceFile, fileSha256, records: [], parseError: err.message };
    }
  }
}
