import { normalizeEan } from "@/domain/catalog/ean";
import { detectSubcategory, getSubcategory } from "@/domain/questions/catalog";
import { acceptRow, type AdapterStore, type ParseResult } from "./types";

// Field parsing shared by the Google Shopping XML and CSV adapters. Both
// produce the same loosely-typed record; this turns it into a normalised
// offer or a rejection with a reason.

export type FeedRecord = {
  id?: string;
  title?: string;
  description?: string;
  link?: string;
  image_link?: string;
  price?: string;
  sale_price?: string;
  availability?: string;
  gtin?: string;
  brand?: string;
  mpn?: string;
  condition?: string;
  product_type?: string;
  google_product_category?: string;
  /** Store-specific extras: delivery days, warranty, grade. */
  shipping_days?: string;
  warranty_months?: string;
  grade?: string;
  energy_kwh_year?: string;
};

/** "699.00 EUR", "1 079,00 EUR", "649" → cents. Only EUR is accepted. */
export function parsePriceCents(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.trim().match(/^([\d\s  .,]+)\s*(EUR|€)?$/i);
  if (!m) return null;
  let num = m[1]!.replace(/[\s  ]/g, "");
  // "1.079,00" (comma decimal) vs "1079.00" (dot decimal)
  if (num.includes(",") && num.includes(".")) num = num.replace(/\./g, "").replace(",", ".");
  else if (num.includes(",")) num = num.replace(",", ".");
  const value = Number(num);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function parseAvailability(text: string | undefined): "in" | "soon" | "out" | null {
  const t = (text ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (["in_stock", "instock", "in", "available", "ir_noliktavā", "yes"].includes(t)) return "in";
  if (["preorder", "backorder", "pre_order", "coming_soon", "soon", "drīzumā"].includes(t)) return "soon";
  if (["out_of_stock", "outofstock", "out", "no", "nav"].includes(t)) return "out";
  return null;
}

export function parseCondition(text: string | undefined): "new" | "refurbished" | null {
  const t = (text ?? "new").trim().toLowerCase();
  if (t === "new" || t === "jauna" || t === "jauns") return "new";
  if (["refurbished", "atjaunota", "atjaunots", "used", "lietota", "lietots"].includes(t))
    return "refurbished";
  return null;
}

/**
 * Feed category → subcategory id. Exact match in the store's map first
 * (case-insensitive, last path segment or full path), then the free-text
 * regex table. Null means we don't handle the category and the row is
 * skipped, which is the normal case for most of a shop's catalogue.
 */
export function mapCategory(record: FeedRecord, store: AdapterStore): string | null {
  const candidates = [record.product_type, record.google_product_category].filter(Boolean) as string[];
  const map = Object.fromEntries(
    Object.entries(store.categoryMap ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const c of candidates) {
    const full = c.toLowerCase().trim();
    const last = full.split(/\s*[>/|]\s*/).pop() ?? full;
    const hit = map[full] ?? map[last];
    if (hit && getSubcategory(hit)) return hit;
  }
  if (store.strictCategories) return null;
  for (const c of candidates) {
    const hit = detectSubcategory(c);
    if (hit) return hit;
  }
  return null;
}

function intOrNull(text: string | undefined): number | null {
  if (!text) return null;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}

/** Shared: validates a feed record and pushes it to the result. */
export function recordToOffer(
  record: FeedRecord,
  store: AdapterStore,
  result: ParseResult,
  raw: unknown,
): void {
  const subcategoryId = mapCategory(record, store);
  if (!subcategoryId) {
    result.rejected.push({
      reason: "unmapped_category",
      raw: record.product_type ?? record.google_product_category ?? null,
    });
    return;
  }
  const priceCents = parsePriceCents(record.sale_price) ?? parsePriceCents(record.price);
  const stock = parseAvailability(record.availability);
  const condition = parseCondition(record.condition);
  if (!priceCents) return void result.rejected.push({ reason: "price", raw });
  if (!stock) return void result.rejected.push({ reason: "availability", raw });
  if (!condition) return void result.rejected.push({ reason: "condition", raw });

  const ean = normalizeEan(record.gtin);
  const brand = record.brand?.trim() || record.title?.split(/\s+/)[0] || "";
  const modelCode = record.mpn?.trim() || "";
  if (!ean && !modelCode) return void result.rejected.push({ reason: "no_identity", raw });

  acceptRow(
    result,
    {
      externalId: record.id,
      ean,
      brand,
      modelCode: modelCode || ean,
      name: record.title?.trim(),
      description: record.description?.trim() || null,
      subcategoryId,
      attributes: {},
      tags: [],
      specs: null,
      kwhYear: intOrNull(record.energy_kwh_year),
      rating: null,
      imageUrl: record.image_link?.trim() || null,
      condition,
      grade: record.grade?.trim() || null,
      warrantyMonths: intOrNull(record.warranty_months),
      priceCents,
      stock,
      deliveryEtaDays: intOrNull(record.shipping_days),
      url: record.link?.trim(),
    },
    raw,
  );
}
