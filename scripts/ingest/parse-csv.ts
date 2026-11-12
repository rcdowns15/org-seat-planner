// CSV parser for Workday report files (RFC 4180 quoting). Written on its own, not shared with the
// seed's CSV writer (scripts/seed/csv.ts), so a quoting bug in one can't hide behind a matching
// bug in the other. It reads fields by splitting the text into lines first, then joining lines
// that sit inside an open quote; the seed's code walks the text character by character.
//
// Accepts a leading UTF-8 byte order mark, and CRLF or LF line endings. Field text is returned
// unchanged (no trimming). A quoted field may contain commas, doubled quotes and line breaks.

export class CsvSyntaxError extends Error {}

const BOM = "﻿";

// Splits one logical record into fields. `record` has no line break outside quotes.
function splitRecord(record: string, recordNumber: number): string[] {
  const fields: string[] = [];
  let pos = 0;
  for (;;) {
    if (record[pos] === '"') {
      // Quoted field: read up to the closing quote, turning "" into ".
      let value = "";
      pos++;
      for (;;) {
        const next = record.indexOf('"', pos);
        if (next === -1) throw new CsvSyntaxError(`record ${recordNumber}: unclosed quote`);
        value += record.slice(pos, next);
        if (record[next + 1] === '"') {
          value += '"';
          pos = next + 2;
        } else {
          pos = next + 1;
          break;
        }
      }
      if (pos < record.length && record[pos] !== ",") {
        throw new CsvSyntaxError(`record ${recordNumber}: text after a closing quote`);
      }
      fields.push(value);
    } else {
      const comma = record.indexOf(",", pos);
      const end = comma === -1 ? record.length : comma;
      const value = record.slice(pos, end);
      if (value.includes('"')) {
        throw new CsvSyntaxError(`record ${recordNumber}: quote inside an unquoted field`);
      }
      fields.push(value);
      pos = end;
    }
    if (pos >= record.length) return fields;
    pos++; // skip the comma; a trailing comma leaves one more empty field
    if (pos === record.length) {
      fields.push("");
      return fields;
    }
  }
}

// Returns every record, header first. Blank lines (such as the one after the final line break)
// are skipped.
export function parseReportCsv(text: string): string[][] {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  const lines = body.split("\n");
  const records: string[][] = [];
  let pending: string | null = null;
  for (const line of lines) {
    // A record continues onto the next line while it holds an odd number of quote characters.
    // Lines are joined with their carriage returns intact, so a line break inside a quoted
    // field comes through unchanged.
    const joined: string = pending === null ? line : `${pending}\n${line}`;
    const quotes = joined.split('"').length - 1;
    if (quotes % 2 === 1) {
      pending = joined;
      continue;
    }
    pending = null;
    const record = joined.endsWith("\r") ? joined.slice(0, -1) : joined;
    if (record === "") continue;
    records.push(splitRecord(record, records.length + 1));
  }
  if (pending !== null) throw new CsvSyntaxError("the file ends inside a quoted field");
  return records;
}
