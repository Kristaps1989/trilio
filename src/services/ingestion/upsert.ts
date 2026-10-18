import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { offers, priceSnapshots, products, type Store } from "@/db/schema";
import { modelKey } from "@/domain/catalog/ean";
import { mergeAttributes } from "@/domain/catalog/normalise";
import type { UpsertRow } from "./types";

export type UpsertStats = { productsCreated: number; offersUpserted: number; snapshots: number };

/**
 * Writes normalised offers for one store. Product identity: EAN first, then
 * brand + normalised model code. A PriceSnapshot is written for every offer on
 * every run (Omnibus 30-day low, radar sparklines). Runs in one transaction so
 * a failed feed never leaves half a store updated.
 */
export async function upsertOffers(
  db: Db,
  store: Pick<Store, "id">,
  rows: UpsertRow[],
  capturedAt = new Date(),
): Promise<UpsertStats> {
  const stats: UpsertStats = { productsCreated: 0, offersUpserted: 0, snapshots: 0 };
  if (rows.length === 0) return stats;

  await db.transaction(async (tx) => {
    // Resolve products in bulk: one lookup by EAN, one by model key.
    const eans = [...new Set(rows.map((r) => r.ean).filter((e): e is string => !!e))];
    const keys = [...new Set(rows.map((r) => modelKey(r.brand, r.modelCode)))];
    const existing = await tx
      .select({
        id: products.id,
        ean: products.ean,
        modelKey: products.modelKey,
        name: products.name,
        attributes: products.attributes,
        attributeSources: products.attributeSources,
      })
      .from(products)
      .where(
        eans.length
          ? sql`${products.ean} in ${eans} or ${products.modelKey} in ${keys}`
          : inArray(products.modelKey, keys),
      );
    const byEan = new Map(existing.filter((p) => p.ean).map((p) => [p.ean!, p.id]));
    const byKey = new Map(existing.map((p) => [p.modelKey, p.id]));
    // What each product already knows, updated as rows of this batch are merged in.
    const known = new Map(
      existing.map((p) => [p.id, { name: p.name, attributes: p.attributes, sources: p.attributeSources }]),
    );

    const productIdFor = new Map<number, string>();
    for (const [i, row] of rows.entries()) {
      const key = modelKey(row.brand, row.modelCode);
      let id = (row.ean && byEan.get(row.ean)) || byKey.get(key);
      if (!id) {
        const [created] = await tx
          .insert(products)
          .values({
            ean: row.ean,
            brand: row.brand,
            modelCode: row.modelCode,
            modelKey: key,
            name: row.name,
            subcategoryId: row.subcategoryId,
            attributes: row.attributes,
            attributeSources: sourcesOf(row),
            specTable: row.specTable ?? null,
            tags: row.tags,
            specs: row.specs,
            description: row.description,
            kwhYear: row.kwhYear,
            rating: row.rating,
            imageUrl: row.imageUrl,
          })
          .returning({ id: products.id });
        id = created!.id;
        known.set(id, { name: row.name, attributes: row.attributes, sources: sourcesOf(row) });
        stats.productsCreated++;
        if (row.ean) byEan.set(row.ean, id);
        byKey.set(key, id);
      } else if (row.condition === "new") {
        // Refurbished rows never overwrite the product's descriptive data. Attributes
        // merge by source strength, so each shop's spec table fills the others' gaps.
        const before = known.get(id) ?? { name: row.name, attributes: {}, sources: {} };
        const merged = mergeAttributes(before, { attributes: row.attributes, sources: sourcesOf(row) });
        // The more descriptive name wins: some shops list only the model code.
        const name = row.name.length >= before.name.length ? row.name : before.name;
        known.set(id, { name, attributes: merged.attributes, sources: merged.sources });
        await tx
          .update(products)
          .set({
            name,
            attributes: merged.attributes,
            attributeSources: merged.sources,
            specTable: row.specTable ?? sql`${products.specTable}`,
            tags: row.tags,
            specs: row.specs,
            description: row.description,
            kwhYear:
              row.kwhYear ??
              (typeof merged.attributes.kwh_year === "number" ? Math.round(merged.attributes.kwh_year) : null) ??
              sql`${products.kwhYear}`,
            rating: row.rating ?? sql`${products.rating}`,
            imageUrl: row.imageUrl ?? sql`${products.imageUrl}`,
            ean: row.ean ?? sql`${products.ean}`,
            updatedAt: capturedAt,
          })
          .where(eq(products.id, id));
      }
      productIdFor.set(i, id);
    }

    for (const [i, row] of rows.entries()) {
      const [offer] = await tx
        .insert(offers)
        .values({
          productId: productIdFor.get(i)!,
          storeId: store.id,
          externalId: row.externalId,
          condition: row.condition,
          grade: row.grade,
          warrantyMonths: row.warrantyMonths,
          priceCents: row.priceCents,
          stock: row.stock,
          deliveryEtaDays: row.deliveryEtaDays,
          url: row.url,
          lastSeenAt: capturedAt,
        })
        .onConflictDoUpdate({
          target: [offers.storeId, offers.externalId],
          set: {
            productId: productIdFor.get(i)!,
            condition: row.condition,
            grade: row.grade,
            warrantyMonths: row.warrantyMonths,
            priceCents: row.priceCents,
            stock: row.stock,
            deliveryEtaDays: row.deliveryEtaDays,
            url: row.url,
            lastSeenAt: capturedAt,
          },
        })
        .returning({ id: offers.id });
      stats.offersUpserted++;
      await tx
        .insert(priceSnapshots)
        .values({ offerId: offer!.id, priceCents: row.priceCents, stock: row.stock, capturedAt });
      stats.snapshots++;
    }
  });

  return stats;
}

/**
 * Offers of this store not seen for `graceHours` are marked out of stock
 * (feeds occasionally drop items for a run; a day's grace avoids flapping).
 */
export async function markUnseenOutOfStock(
  db: Db,
  store: Pick<Store, "id">,
  now = new Date(),
  graceHours = 24,
): Promise<number> {
  const cutoff = new Date(now.getTime() - graceHours * 3_600_000);
  const updated = await db
    .update(offers)
    .set({ stock: "out" })
    .where(and(eq(offers.storeId, store.id), lt(offers.lastSeenAt, cutoff), sql`${offers.stock} <> 'out'`))
    .returning({ id: offers.id });
  return updated.length;
}

/** Provenance for a row's attributes; feed rows without explicit sources count as "feed". */
function sourcesOf(row: UpsertRow): Record<string, string> {
  if (row.attributeSources && Object.keys(row.attributeSources).length) return row.attributeSources;
  return Object.fromEntries(Object.keys(row.attributes).map((k) => [k, "feed"]));
}
