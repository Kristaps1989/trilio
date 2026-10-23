import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { offers, products, stores } from "@/db/schema";
import { excludedByName } from "@/domain/catalog/normalise";
import type { OfferView, ProductView } from "@/domain/catalog/types";
import { currentMarket } from "@/i18n/market";

// Maps database rows to the plain ProductView the domain works on. The
// 30-day low is computed in SQL per offer (one aggregate, not 100k rows):
// the minimum over the window counts only when at least one snapshot in the
// window differs from the current price, so a brand-new offer has no
// "history" (see domain/pricing/omnibus.ts).

type OfferRow = {
  productId: string;
  offerId: string;
  storeId: string;
  storeName: string;
  storeDefaultDeliveryDays: number;
  condition: "new" | "refurbished";
  grade: string | null;
  warrantyMonths: number | null;
  priceCents: number;
  stock: "in" | "soon" | "out";
  deliveryEtaDays: number | null;
  url: string;
  lowest30dCents: number | null;
};

async function offerRows(db: Db, where: ReturnType<typeof and> | undefined): Promise<OfferRow[]> {
  const rows = await db
    .select({
      productId: offers.productId,
      offerId: offers.id,
      storeId: stores.id,
      storeName: stores.displayName,
      storeDefaultDeliveryDays: stores.defaultDeliveryDays,
      condition: offers.condition,
      grade: offers.grade,
      warrantyMonths: offers.warrantyMonths,
      priceCents: offers.priceCents,
      stock: offers.stock,
      deliveryEtaDays: offers.deliveryEtaDays,
      url: offers.url,
      lowest30dCents: sql<number | null>`(
        select case when min(s.price_cents) filter (where s.price_cents <> ${offers.priceCents}) is null
                    then null else min(s.price_cents) end
        from price_snapshots s
        where s.offer_id = ${offers.id} and s.captured_at >= now() - interval '30 days'
      )`,
    })
    .from(offers)
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .innerJoin(products, eq(products.id, offers.productId))
    .where(and(eq(stores.active, true), eq(stores.country, currentMarket().country), where));
  return rows as OfferRow[];
}

function toOffer(r: OfferRow): OfferView {
  return {
    id: r.offerId,
    storeId: r.storeId,
    storeName: r.storeName,
    condition: r.condition,
    grade: r.grade,
    warrantyMonths: r.warrantyMonths,
    priceCents: r.priceCents,
    stock: r.stock,
    deliveryEtaDays: r.deliveryEtaDays,
    storeDefaultDeliveryDays: r.storeDefaultDeliveryDays,
    url: r.url,
    lowest30dCents: r.lowest30dCents === null ? null : Number(r.lowest30dCents),
  };
}

type ProductRow = typeof products.$inferSelect;

function toProduct(p: ProductRow, productOffers: OfferView[]): ProductView {
  return {
    id: p.id,
    ean: p.ean,
    brand: p.brand,
    modelCode: p.modelCode,
    name: p.name,
    subcategoryId: p.subcategoryId,
    attributes: p.attributes,
    tags: p.tags,
    specs: p.specs,
    kwhYear: p.kwhYear,
    rating: p.rating,
    imageUrl: p.imageUrl,
    eprelId: p.eprelId,
    extractionConfidence: p.extractionConfidence,
    offers: productOffers,
  };
}

/** All products of a subcategory with their offers from active stores. */
export async function loadCandidates(db: Db, subcategoryId: string): Promise<ProductView[]> {
  // Accessories and mis-filed appliances stored before their name pattern existed stay out too.
  const productRows = (
    await db.select().from(products).where(eq(products.subcategoryId, subcategoryId))
  ).filter((p) => !excludedByName(subcategoryId, p.name));
  if (productRows.length === 0) return [];
  const rows = await offerRows(db, eq(products.subcategoryId, subcategoryId));
  return assemble(productRows, rows);
}

/** One product by id with its offers, or null. */
export async function loadProduct(db: Db, productId: string): Promise<ProductView | null> {
  const [p] = await db.select().from(products).where(eq(products.id, productId));
  if (!p) return null;
  const rows = await offerRows(db, eq(offers.productId, productId));
  return assemble([p], rows)[0] ?? null;
}

/** Products by ids (radar evaluator, compare). */
export async function loadProducts(db: Db, ids: string[]): Promise<ProductView[]> {
  if (ids.length === 0) return [];
  const productRows = await db
    .select()
    .from(products)
    .where(sql`${products.id} in ${ids}`);
  const rows = await offerRows(db, sql`${offers.productId} in ${ids}`);
  return assemble(productRows, rows);
}

/**
 * Model-check lookup: by normalised model code, EAN, or name similarity.
 * Returns up to `limit` products best match first.
 */
/**
 * The words of a search, each matched on its own so word order does not
 * matter ("Airfryer Philips" finds "Philips Airfryer XL"). LIKE wildcards are
 * escaped; at most 8 words of 2+ characters.
 */
export function searchWords(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 8)
    .map((w) => w.replace(/[\\%_]/g, (c) => `\\${c}`));
}

export async function searchProducts(db: Db, query: string, limit = 5): Promise<ProductView[]> {
  const q = query.trim();
  if (!q) return [];
  const code = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const words = searchWords(q);
  const allWords = words.length
    ? sql.join(
        words.map(
          (w) =>
            sql`(${products.name} ilike ${"%" + w + "%"} or ${products.brand} ilike ${"%" + w + "%"} or ${products.modelCode} ilike ${"%" + w + "%"})`,
        ),
        sql` and `,
      )
    : sql`false`;
  const productRows = await db
    .select()
    .from(products)
    .where(
      sql`${products.ean} = ${q}
        or (${code} <> '' and upper(regexp_replace(${products.modelCode}, '[^A-Za-z0-9]', '', 'g')) like ${"%" + code + "%"})
        or (${allWords})`,
    )
    .orderBy(
      sql`case when ${products.ean} = ${q} then 0 when upper(regexp_replace(${products.modelCode}, '[^A-Za-z0-9]', '', 'g')) = ${code} then 1 when ${products.name} ilike ${"%" + q + "%"} then 2 else 3 end`,
    )
    .limit(limit);
  if (productRows.length === 0) return [];
  const ids = productRows.map((p) => p.id);
  const rows = await offerRows(db, sql`${offers.productId} in ${ids}`);
  return assemble(productRows, rows);
}

/** Subcategories that currently have refurbished stock (drives the optional refurbished question). */
export async function subcategoriesWithRefurbished(db: Db): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ subcategoryId: products.subcategoryId })
    .from(offers)
    .innerJoin(products, eq(products.id, offers.productId))
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .where(
      and(
        eq(offers.condition, "refurbished"),
        eq(stores.active, true),
        eq(stores.country, currentMarket().country),
        sql`${offers.stock} <> 'out'`,
      ),
    );
  return new Set(rows.map((r) => r.subcategoryId));
}

function assemble(productRows: ProductRow[], rows: OfferRow[]): ProductView[] {
  const byProduct = new Map<string, OfferView[]>();
  for (const r of rows) {
    const list = byProduct.get(r.productId) ?? [];
    list.push(toOffer(r));
    byProduct.set(r.productId, list);
  }
  return productRows.map((p) => toProduct(p, byProduct.get(p.id) ?? []));
}
