import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  offers,
  priceSnapshots,
  products,
  radarEvents,
  radars,
  searchSessions,
  stores,
  type Radar,
} from "@/db/schema";
import type { Answers } from "@/domain/questions/schema";

// Radar persistence. Every mutation filters by user id (ownership check).

export type RadarInput = {
  productId: string;
  searchSessionId: string | null;
  threshold: "any" | "5" | "10";
  scope: "only" | "brand" | "any";
  channels: ("push" | "email")[];
};

export async function createRadar(
  db: Db,
  userId: string,
  input: RadarInput,
  baselinePriceCents: number | null,
): Promise<Radar> {
  const [r] = await db
    .insert(radars)
    .values({ ...input, userId, baselinePriceCents })
    .returning();
  return r!;
}

export type RadarFilters = {
  threshold?: "any" | "5" | "10";
  scope?: "only" | "brand" | "any";
  storeIds?: string[];
  includeRefurbished?: boolean;
  channels?: ("push" | "email")[];
  paused?: boolean;
};

export async function updateRadar(
  db: Db,
  userId: string,
  radarId: string,
  patch: RadarFilters,
): Promise<boolean> {
  const rows = await db
    .update(radars)
    .set(patch)
    .where(and(eq(radars.id, radarId), eq(radars.userId, userId), isNull(radars.deletedAt)))
    .returning({ id: radars.id });
  return rows.length > 0;
}

/** Soft delete with undo window; purged by the evaluator job after a day. */
export async function softDeleteRadar(
  db: Db,
  userId: string,
  radarId: string,
  restore = false,
): Promise<boolean> {
  const rows = await db
    .update(radars)
    .set({ deletedAt: restore ? null : new Date() })
    .where(and(eq(radars.id, radarId), eq(radars.userId, userId)))
    .returning({ id: radars.id });
  return rows.length > 0;
}

export async function purgeDeletedRadars(
  db: Db,
  olderThan = new Date(Date.now() - 86_400_000),
): Promise<number> {
  const rows = await db
    .delete(radars)
    .where(and(isNotNull(radars.deletedAt), lt(radars.deletedAt, olderThan)))
    .returning({ id: radars.id });
  return rows.length;
}

export type RadarListItem = {
  radar: Radar;
  product: {
    id: string;
    name: string;
    brand: string;
    modelCode: string;
    ean: string | null;
    subcategoryId: string;
  };
  /** Best current new (or refurbished when included) offer in the watched stores. */
  currentPriceCents: number | null;
  currentStoreName: string | null;
  /** 30 daily points for the sparkline (min price per day across watched stores). */
  sparkline: { day: string; priceCents: number }[];
  answers: Answers | null;
};

export async function listRadars(db: Db, userId: string): Promise<RadarListItem[]> {
  const rows = await db
    .select({ radar: radars, product: products, session: searchSessions })
    .from(radars)
    .innerJoin(products, eq(products.id, radars.productId))
    .leftJoin(searchSessions, eq(searchSessions.id, radars.searchSessionId))
    .where(and(eq(radars.userId, userId), isNull(radars.deletedAt)))
    .orderBy(desc(radars.createdAt));
  const items: RadarListItem[] = [];
  for (const row of rows) {
    const r = row.radar;
    const storeFilter = r.storeIds.length ? sql`and ${offers.storeId} in ${r.storeIds}` : sql``;
    const conditionFilter = r.includeRefurbished ? sql`` : sql`and ${offers.condition} = 'new'`;
    const [best] = await db
      .select({ priceCents: offers.priceCents, storeName: stores.displayName })
      .from(offers)
      .innerJoin(stores, eq(stores.id, offers.storeId))
      .where(
        sql`${offers.productId} = ${r.productId} and ${offers.stock} <> 'out' and ${stores.active} = true ${storeFilter} ${conditionFilter}`,
      )
      .orderBy(offers.priceCents)
      .limit(1);
    const spark = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${priceSnapshots.capturedAt}), 'YYYY-MM-DD')`,
        priceCents: sql<number>`min(${priceSnapshots.priceCents})`,
      })
      .from(priceSnapshots)
      .innerJoin(offers, eq(offers.id, priceSnapshots.offerId))
      .where(
        sql`${offers.productId} = ${r.productId} and ${priceSnapshots.capturedAt} >= now() - interval '30 days' ${storeFilter} ${conditionFilter}`,
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const answers = row.session?.answers ? (stripTrailing(row.session.answers) as Answers) : null;
    items.push({
      radar: r,
      product: {
        id: row.product.id,
        name: row.product.name,
        brand: row.product.brand,
        modelCode: row.product.modelCode,
        ean: row.product.ean,
        subcategoryId: row.product.subcategoryId,
      },
      currentPriceCents: best?.priceCents ?? null,
      currentStoreName: best?.storeName ?? null,
      sparkline: spark.map((s) => ({ day: s.day, priceCents: Number(s.priceCents) })),
      answers,
    });
  }
  return items;
}

function stripTrailing(answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) if (!k.startsWith("$")) out[k] = v;
  return out;
}

/** Active (not paused, not deleted) radars with their saved answers, for the evaluator. */
export async function activeRadarsForEvaluation(db: Db) {
  return db
    .select({ radar: radars, answers: searchSessions.answers, userId: radars.userId })
    .from(radars)
    .leftJoin(searchSessions, eq(searchSessions.id, radars.searchSessionId))
    .where(and(isNull(radars.deletedAt), eq(radars.paused, false)));
}

export async function recordRadarEvent(
  db: Db,
  radarId: string,
  e: {
    kind: "drop" | "similar";
    productId: string;
    offerId: string;
    oldPriceCents: number;
    newPriceCents: number;
  },
  channels: string[],
) {
  await db.insert(radarEvents).values({
    radarId,
    kind: e.kind,
    productId: e.productId,
    offerId: e.offerId,
    oldPriceCents: e.oldPriceCents,
    newPriceCents: e.newPriceCents,
    channels,
  });
}

export async function recentEvents(db: Db, radarId: string, since: Date) {
  return db
    .select()
    .from(radarEvents)
    .where(and(eq(radarEvents.radarId, radarId), gte(radarEvents.sentAt, since)));
}
