// Minimal CSV writer and parser (RFC 4180 quoting). The writer produces what a typical Workday
// export looks like (D-031): a UTF-8 byte order mark, CRLF line endings, and quotes around any
// field that contains a comma, quote or line break. The output is the same bytes on every OS.

export const BOM = "\uFEFF";

function quote(field: string): string {
  return /[",\n\r]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

export function formatCsv(header: readonly string[], rows: readonly string[][]): string {
  return BOM + [header, ...rows].map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
}

// Accepts LF or CRLF line endings and skips a leading byte order mark.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = text.startsWith(BOM) ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
