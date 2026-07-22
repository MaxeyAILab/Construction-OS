// RFC 4180-ish CSV encode/decode — hand-rolled rather than adding a
// dependency for what's a small, well-specified format: quote a field iff
// it contains a comma/quote/newline, double up internal quotes.

export function toCsv(headers: string[], rows: Array<Record<string, string>>): string {
  const lines = [headers.map(encodeField).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => encodeField(row[h] ?? "")).join(","));
  }
  return lines.join("\r\n");
}

function encodeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Returns every row (including the header row) as an array of raw string
// cells. Handles quoted fields with embedded commas/newlines/escaped quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// Splits a parsed CSV into its header row and one plain object per data
// row, keyed by the raw column header — the shape a field mapping ({
// targetField: sourceColumnHeader }) is applied against.
export function csvToRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const rows = parseCsv(text);
  const [headers, ...dataRows] = rows;
  if (!headers) return { headers: [], records: [] };

  const records = dataRows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = row[i] ?? "";
    });
    return record;
  });
  return { headers, records };
}
