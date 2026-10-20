import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { notifySettings, offers, priceSnapshots, savedItems, stores, type SavedItem } from "@/db/schema";
import { productKey, searchKey, type Threshold } from "@/domain/wishlist/wishlist";

// Wishlist persistence. Every read and write is scoped to the user id.

export async function saveProduct(
  db: Db,
  userId: string,
  input: { productId: string; subcategoryId: string; baselinePriceCents: number | null },
): Promise<void> {
  await db
    .insert(savedItems)
    .values({
      userId,
      kind: "product",
      key: productKey(input.productId),
      productId: input.productId,
      subcategoryId: input.subcategoryId,
      baselinePriceCents: input.baselinePriceCents,
    })
    .onConflictDoNothing();
}

export async function saveSearch(
  db: Db,
  userId: string,
  input: { subcategoryId: string; answersParam: string; label: string; baselinePriceCents: number | null },
): Promise<void> {
  await db
    .insert(savedItems)
    .values({
      userId,
      kind: "search",
      key: searchKey(input.subcategoryId, input.answersParam),
      subcategoryId: input.subcategoryId,
      answersParam: input.answersParam,
      label: input.label.slice(0, 300),
      baselinePriceCents: input.baselinePriceCents,
    })
    .onConflictDoNothing();
}

export async function removeSaved(db: Db, userId: string, key: string): Promise<boolean> {
  const rows = await db
    .delete(savedItems)
    .where(and(eq(savedItems.userId, userId), eq(savedItems.key, key)))
    .returning({ id: savedItems.id });
  return rows.length > 0;
}

/** Which of these keys the user has saved (hearts drawn filled). */
export async function savedKeys(
  db: Db,
  userId: string | null | undefined,
  keys: string[],
): Promise<Set<string>> {
  if (!userId || keys.length === 0) return new Set();
  const rows = await db
    .select({ key: savedItems.key })
    .from(savedItems)
    .where(and(eq(savedItems.userId, userId), inArray(savedItems.key, keys)));
  return new Set(rows.map((r) => r.key));
}

export async function listSaved(db: Db, userId: string): Promise<SavedItem[]> {
  return db
    .select()
    .from(savedItems)
    .where(eq(savedItems.userId, userId))
    .orderBy(desc(savedItems.createdAt));
}

/** Lowest new in-stock price per day over the last `days` days, across active shops. */
export async function priceHistory(
  db: Db,
  productId: string,
  days = 90,
): Promise<{ day: string; priceCents: number }[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${priceSnapshots.capturedAt}), 'YYYY-MM-DD')`,
      priceCents: sql<number>`min(${priceSnapshots.priceCents})`,
    })
    .from(priceSnapshots)
    .innerJoin(offers, eq(offers.id, priceSnapshots.offerId))
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .where(
      sql`${offers.productId} = ${productId} and ${offers.condition} = 'new' and ${stores.active} = true
        and ${priceSnapshots.stock} <> 'out'
        and ${priceSnapshots.capturedAt} >= now() - make_interval(days => ${days})`,
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ day: r.day, priceCents: Number(r.priceCents) }));
}

export async function getThreshold(db: Db, userId: string): Promise<Threshold> {
  const [row] = await db.select().from(notifySettings).where(eq(notifySettings.userId, userId));
  return row?.threshold ?? "5";
}

export async function setThreshold(db: Db, userId: string, threshold: Threshold): Promise<void> {
  await db
    .insert(notifySettings)
    .values({ userId, threshold })
    .onConflictDoUpdate({ target: notifySettings.userId, set: { threshold, updatedAt: new Date() } });
}

/** Every saved item with its owner's threshold, for the daily digest. */
export async function itemsForEvaluation(db: Db) {
  return db
    .select({ item: savedItems, threshold: notifySettings.threshold })
    .from(savedItems)
    .leftJoin(notifySettings, eq(notifySettings.userId, savedItems.userId));
}

export async function markNotified(db: Db, itemId: string, newBaselineCents: number, now: Date) {
  await db
    .update(savedItems)
    .set({ baselinePriceCents: newBaselineCents, lastNotifiedAt: now })
    .where(eq(savedItems.id, itemId));
}

export async function setBaseline(db: Db, itemId: string, cents: number) {
  await db.update(savedItems).set({ baselinePriceCents: cents }).where(eq(savedItems.id, itemId));
}
