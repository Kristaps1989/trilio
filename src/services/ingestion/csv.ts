import { recordToOffer, type FeedRecord } from "./common";
import type { AdapterStore, FeedAdapter, ParseResult } from "./types";

// CSV / TSV feed with a header row. Column names follow the Google Shopping
// attribute names by default; a store can map its own headers through
// `columnMap` ({ "Prece": "title", "Cena": "price", … }).

const DEFAULT_COLUMNS: Record<string, Exclude<keyof FeedRecord, "spec_table">> = {
  id: "id",
  title: "title",
  description: "description",
  link: "link",
  image_link: "image_link",
  price: "price",
  sale_price: "sale_price",
  availability: "availability",
  gtin: "gtin",
  ean: "gtin",
  brand: "brand",
  mpn: "mpn",
  model: "mpn",
  condition: "condition",
  product_type: "product_type",
  category: "product_type",
  google_product_category: "google_product_category",
  shipping_days: "shipping_days",
  warranty_months: "warranty_months",
  grade: "grade",
  energy_kwh_year: "energy_kwh_year",
};

/** RFC 4180-ish parser: quoted fields, doubled quotes, CRLF, configurable delimiter. */
export function parseCsv(body: string, delimiter?: string): string[][] {
  const d =
    delimiter ??
    (body.split("\n", 1)[0]!.includes("\t") ? "\t" : body.split("\n", 1)[0]!.includes(";") ? ";" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === d) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

export type CsvStore = AdapterStore & { columnMap?: Record<string, string>; delimiter?: string };

export const csvAdapter: FeedAdapter = {
  type: "csv",
  parse(body: string, store: CsvStore): ParseResult {
    const result: ParseResult = { offers: [], rejected: [] };
    const rows = parseCsv(body.replace(/^\uFEFF/, ""), store.delimiter);
    const header = rows.shift();
    if (!header) {
      result.rejected.push({ reason: "empty", raw: null });
      return result;
    }
    const map: Record<string, Exclude<keyof FeedRecord, "spec_table">> = {
      ...DEFAULT_COLUMNS,
      ...Object.fromEntries(
        Object.entries(store.columnMap ?? {}).map(([k, v]) => [k.toLowerCase(), v as Exclude<keyof FeedRecord, "spec_table">]),
      ),
    };
    const columns = header.map((h) => map[h.trim().toLowerCase().replace(/^g:/, "")]);
    if (!columns.includes("id") || !columns.includes("price")) {
      result.rejected.push({ reason: "header: id and price columns required", raw: header });
      return result;
    }
    for (const cells of rows) {
      const record: FeedRecord = {};
      cells.forEach((cell, i) => {
        const key = columns[i];
        if (key && cell !== "") record[key] = cell;
      });
      recordToOffer(record, store, result, { id: record.id, title: record.title });
    }
    return result;
  },
};
