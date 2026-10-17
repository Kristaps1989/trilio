import { XMLParser } from "fast-xml-parser";
import { recordToOffer, type FeedRecord } from "./common";
import type { AdapterStore, FeedAdapter, ParseResult } from "./types";

// Google Shopping product feed (RSS 2.0 with the g: namespace, or Atom).
// This is the format most shops already produce for Google Merchant and
// affiliate networks, so it is the default for every partner store.

const parser = new XMLParser({
  ignoreAttributes: true,
  // Security: never resolve entities (XXE / billion laughs).
  processEntities: false,
  htmlEntities: false,
  removeNSPrefix: true,
  isArray: (name) => name === "item" || name === "entry",
  trimValues: true,
  parseTagValue: false,
});

function text(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "object") {
    // <g:shipping><g:service>…</g:service></g:shipping> and similar nested nodes are not plain strings.
    const t = (v as Record<string, unknown>)["#text"];
    return typeof t === "string" ? t : undefined;
  }
  return String(v);
}

function toRecord(item: Record<string, unknown>): FeedRecord {
  const first = (k: string) => {
    const v = item[k];
    return Array.isArray(v) ? text(v[0]) : text(v);
  };
  return {
    id: first("id"),
    title: first("title"),
    description: first("description"),
    link: first("link"),
    image_link: first("image_link"),
    price: first("price"),
    sale_price: first("sale_price"),
    availability: first("availability"),
    gtin: first("gtin"),
    brand: first("brand"),
    mpn: first("mpn"),
    condition: first("condition"),
    product_type: first("product_type"),
    google_product_category: first("google_product_category"),
    shipping_days: first("shipping_days"),
    warranty_months: first("warranty_months"),
    grade: first("grade"),
    energy_kwh_year: first("energy_kwh_year"),
  };
}

export const googleXmlAdapter: FeedAdapter = {
  type: "google_xml",
  parse(body: string, store: AdapterStore): ParseResult {
    const result: ParseResult = { offers: [], rejected: [] };
    if (/<!DOCTYPE|<!ENTITY/i.test(body)) {
      result.rejected.push({ reason: "doctype_not_allowed", raw: null });
      return result;
    }
    let doc: Record<string, unknown>;
    try {
      doc = parser.parse(body);
    } catch (err) {
      result.rejected.push({ reason: "xml: " + (err as Error).message, raw: null });
      return result;
    }
    const rss = doc.rss as { channel?: { item?: unknown[] } } | undefined;
    const feed = doc.feed as { entry?: unknown[] } | undefined;
    const items = (rss?.channel?.item ?? feed?.entry ?? []) as Record<string, unknown>[];
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const record = toRecord(item);
      recordToOffer(record, store, result, { id: record.id, title: record.title });
    }
    return result;
  },
};
