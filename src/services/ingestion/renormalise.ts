import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { products } from "@/db/schema";
import { catalogVersion } from "@/domain/catalog/attributes";
import { mergeAttributes, normaliseProduct } from "@/domain/catalog/normalise";

// Re-derives product attributes from what is already stored (name,
// description, spec table) whenever data/attributes.json changes, and for rows
// ingested before attributes existed. No shop is contacted, so new rules reach
// the whole catalogue within one scheduler tick instead of after a full
// re-crawl. Values only rules and spec tables produce are recomputed; feed,
// EPREL and extraction values are kept.

/** Sources that can be rebuilt from stored text, so they are replaced, not merged. */
const DERIVED = new Set(["rule", "spec_table"]);

/** Marker in attribute_sources: the catalogue version these attributes were derived with. */
export const VERSION_KEY = "$catalog";

export function renormaliseOne(
  row: {
    subcategoryId: string;
    name: string;
    description: string | null;
    specTable: Record<string, string> | null;
    attributes: Record<string, unknown>;
    attributeSources: Record<string, string>;
  },
  version = catalogVersion,
): { attributes: Record<string, unknown>; sources: Record<string, string> } {
  const kept = { attributes: {} as Record<string, unknown>, sources: {} as Record<string, string> };
  for (const [key, value] of Object.entries(row.attributes)) {
    const source = row.attributeSources[key];
    if (source && DERIVED.has(source)) continue;
    kept.attributes[key] = value;
    // Values without a recorded source came from the feed or an older pipeline.
    kept.sources[key] = source ?? "feed";
  }
  const derived = normaliseProduct(row.subcategoryId, {
    name: row.name,
    description: row.description,
    specTable: row.specTable,
  });
  const merged = mergeAttributes(kept, derived);
  return { attributes: merged.attributes, sources: { ...merged.sources, [VERSION_KEY]: version } };
}

/**
 * Brings every product to the current catalogue version, in id order and in
 * batches. Returns how many rows were updated.
 */
export async function renormaliseProducts(db: Db, opts: { batch?: number; version?: string } = {}) {
  const batch = opts.batch ?? 500;
  const version = opts.version ?? catalogVersion;
  const stale = sql`coalesce(${products.attributeSources}->>${VERSION_KEY}, '') <> ${version}`;
  let updated = 0;
  let after: string | null = null;
  for (;;) {
    const rows = await db
      .select({
        id: products.id,
        subcategoryId: products.subcategoryId,
        name: products.name,
        description: products.description,
        specTable: products.specTable,
        attributes: products.attributes,
        attributeSources: products.attributeSources,
      })
      .from(products)
      .where(after ? and(stale, gt(products.id, after)) : stale)
      .orderBy(asc(products.id))
      .limit(batch);
    if (rows.length === 0) break;
    for (const row of rows) {
      const next = renormaliseOne(row, version);
      const kwh = typeof next.attributes.kwh_year === "number" ? Math.round(next.attributes.kwh_year) : null;
      await db
        .update(products)
        .set({
          attributes: next.attributes,
          attributeSources: next.sources,
          ...(kwh !== null ? { kwhYear: sql`coalesce(${products.kwhYear}, ${kwh})` } : {}),
        })
        .where(eq(products.id, row.id));
      updated++;
    }
    after = rows[rows.length - 1]!.id;
  }
  return updated;
}
