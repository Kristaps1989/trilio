import { and, count, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  affiliateClicks,
  confidenceAnswers,
  eprelLookups,
  ingestionRuns,
  offerEvents,
  offerOrders,
  offers,
  savedItems,
  searchSessions,
  specialOffers,
  stores,
  subscriptions,
  users,
} from "@/db/schema";
import { loadProducts } from "@/db/queries/catalog";
import { rigaDay } from "@/domain/analytics/visits";
import { daysBetween, paidRatio, quartiles, topAnswers } from "@/domain/admin/stats";
import { isLate } from "@/domain/offers/offers";
import { currentOffer } from "@/domain/wishlist/wishlist";
import { visitRows } from "@/services/visits/visits";

// Read-only queries for /admin (docs/ADMIN_AND_OFFERS_PLAN.md §4). Day
// boundaries are Riga days, like the visit counts.

const DAY_MS = 24 * 3600 * 1000;
const rigaStart = (day: string) => sql`(${day}::date)::timestamp at time zone 'Europe/Riga'`;
const rigaEnd = (day: string) => sql`((${day}::date + 1)::timestamp at time zone 'Europe/Riga')`;

// ---------------------------------------------------------------- Šodien

export type TodoItem = {
  kind: "ship" | "late" | "expiring" | "unpaid" | "return" | "problem" | "ingestion";
  id: string;
  title: string;
  detail: string;
  href: string;
};

export async function todayTodo(db: Db, now = new Date()): Promise<TodoItem[]> {
  const items: TodoItem[] = [];
  const orders = await db
    .select({ order: offerOrders, offer: specialOffers })
    .from(offerOrders)
    .innerJoin(specialOffers, eq(specialOffers.id, offerOrders.offerId))
    .where(
      inArray(offerOrders.status, ["paid", "packed", "shipped", "return_requested", "returned", "delivered"]),
    )
    .orderBy(offerOrders.paidAt);
  const problemsResolved = new Set(
    (
      await db
        .select({ orderId: offerEvents.orderId })
        .from(offerEvents)
        .where(eq(offerEvents.kind, "problem_resolved"))
    ).map((r) => r.orderId),
  );
  for (const { order, offer } of orders) {
    const href = `/admin/pasutijumi/${order.id}`;
    const base = { id: order.id, title: `${order.number} · ${offer.productName}`, href };
    if (order.status === "paid" || order.status === "packed")
      items.push({ ...base, kind: "ship", detail: order.status });
    else if (order.status === "shipped" && isLate(order, now))
      items.push({ ...base, kind: "late", detail: order.carrier ?? "" });
    else if (order.status === "return_requested" || order.status === "returned")
      items.push({ ...base, kind: "return", detail: order.status });
    if (order.feedback === "problem" && !problemsResolved.has(order.id))
      items.push({ ...base, id: `${order.id}:p`, kind: "problem", detail: order.feedbackNote ?? "" });
  }

  const soon = await db
    .select()
    .from(specialOffers)
    .where(
      and(
        inArray(specialOffers.status, ["sent", "opened"]),
        gte(specialOffers.validUntil, now),
        lt(specialOffers.validUntil, new Date(now.getTime() + DAY_MS)),
      ),
    );
  for (const o of soon)
    items.push({
      kind: "expiring",
      id: o.id,
      title: o.productName,
      detail: o.validUntil.toISOString(),
      href: `/admin/piedavajumi/${o.id}`,
    });

  const unpaid = await db
    .select({ order: offerOrders, offer: specialOffers })
    .from(offerOrders)
    .innerJoin(specialOffers, eq(specialOffers.id, offerOrders.offerId))
    .where(eq(offerOrders.status, "awaiting_payment"));
  for (const { order, offer } of unpaid)
    items.push({
      kind: "unpaid",
      id: order.id,
      title: `${order.number} · ${offer.productName}`,
      detail: order.fullName,
      href: `/admin/pasutijumi/${order.id}`,
    });

  for (const run of await lastRuns(db))
    if (run.ok === false)
      items.push({
        kind: "ingestion",
        id: run.storeId,
        title: run.storeName,
        detail: run.error ?? "",
        href: "/admin/sistema",
      });
  return items;
}

export type Headline = {
  visitors: number;
  searches: number;
  offersPaidMonth: number;
  offersSentMonth: number;
  paidRatio: number | null;
  revenueMonthCents: number;
  marginMonthCents: number;
};

export async function headline(db: Db, now = new Date()): Promise<Headline> {
  const today = rigaDay(now);
  const visitors = (await visitRows(db, today, today, now)).reduce((n, r) => n + r.visitors, 0);
  const [s] = await db
    .select({ n: count() })
    .from(searchSessions)
    .where(sql`${searchSessions.createdAt} >= ${rigaStart(today)}`);
  const monthStart = sql`date_trunc('month', now() at time zone 'Europe/Riga') at time zone 'Europe/Riga'`;
  const [sent] = await db
    .select({ n: count() })
    .from(specialOffers)
    .where(sql`${specialOffers.sentAt} >= ${monthStart}`);
  const [paid] = await db
    .select({
      n: count(),
      revenue: sql<number>`coalesce(sum(${offerOrders.amountCents}), 0)`.mapWith(Number),
      cost: sql<number>`coalesce(sum(${specialOffers.costCents}), 0)`.mapWith(Number),
    })
    .from(offerOrders)
    .innerJoin(specialOffers, eq(specialOffers.id, offerOrders.offerId))
    .where(
      sql`${offerOrders.paidAt} >= ${monthStart} and ${offerOrders.status} not in ('refunded', 'cancelled')`,
    );
  return {
    visitors,
    searches: Number(s?.n ?? 0),
    offersSentMonth: Number(sent?.n ?? 0),
    offersPaidMonth: Number(paid?.n ?? 0),
    paidRatio: paidRatio(Number(paid?.n ?? 0), Number(sent?.n ?? 0)),
    revenueMonthCents: paid?.revenue ?? 0,
    marginMonthCents: (paid?.revenue ?? 0) - (paid?.cost ?? 0),
  };
}

// ---------------------------------------------------------------- Statistika

export async function visitStats(db: Db, from: string, to: string, now = new Date()) {
  const rows = await visitRows(db, from, to, now);
  const sum = (list: typeof rows) => ({
    views: list.reduce((n, r) => n + r.views, 0),
    visitors: list.reduce((n, r) => n + r.visitors, 0),
  });
  const group = (key: (r: (typeof rows)[number]) => string | null) => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()]
      .map(([k, list]) => ({ key: k, ...sum(list) }))
      .sort((a, b) => b.views - a.views || a.key.localeCompare(b.key));
  };
  const perDay = new Map(group((r) => r.day).map((d) => [d.key, d]));
  return {
    total: sum(rows),
    sections: group((r) => r.section),
    paths: group((r) => r.path),
    subcategories: group((r) => r.subcategory),
    days: daysBetween(from, to).map((day) => ({
      day,
      views: perDay.get(day)?.views ?? 0,
      visitors: perDay.get(day)?.visitors ?? 0,
    })),
  };
}

export async function searchStats(db: Db, from: string, to: string) {
  const rows = await db
    .select({
      subcategoryId: searchSessions.subcategoryId,
      budgetCents: searchSessions.budgetCents,
      answers: searchSessions.answers,
      day: sql<string>`to_char(${searchSessions.createdAt} at time zone 'Europe/Riga', 'YYYY-MM-DD')`,
    })
    .from(searchSessions)
    .where(
      sql`${searchSessions.createdAt} >= ${rigaStart(from)} and ${searchSessions.createdAt} < ${rigaEnd(to)}`,
    );
  const bySub = new Map<string, typeof rows>();
  for (const r of rows) bySub.set(r.subcategoryId, [...(bySub.get(r.subcategoryId) ?? []), r]);
  const perDay = new Map<string, number>();
  for (const r of rows) perDay.set(r.day, (perDay.get(r.day) ?? 0) + 1);
  return {
    total: rows.length,
    days: daysBetween(from, to).map((day) => ({ day, searches: perDay.get(day) ?? 0 })),
    subcategories: [...bySub.entries()]
      .map(([subcategoryId, list]) => ({
        subcategoryId,
        searches: list.length,
        budget: quartiles(list.map((r) => r.budgetCents).filter((b): b is number => b !== null && b > 0)),
        withBudget: list.filter((r) => r.budgetCents).length,
        answers: topAnswers(list.map((r) => r.answers)),
      }))
      .sort((a, b) => b.searches - a.searches || a.subcategoryId.localeCompare(b.subcategoryId)),
  };
}

export async function shopStats(db: Db, from: string, to: string) {
  const rows = await db
    .select({
      store: stores.displayName,
      clicks: count(),
    })
    .from(affiliateClicks)
    .innerJoin(offers, eq(offers.id, affiliateClicks.offerId))
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .where(
      sql`${affiliateClicks.clickedAt} >= ${rigaStart(from)} and ${affiliateClicks.clickedAt} < ${rigaEnd(to)}`,
    )
    .groupBy(stores.displayName)
    .orderBy(desc(count()));
  return rows.map((r) => ({ store: r.store, clicks: Number(r.clicks) }));
}

// ---------------------------------------------------------------- Lietotāji

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  offersOptIn: boolean;
  savedProducts: number;
  savedSearches: number;
  subscribed: boolean;
  offersSent: number;
  ordersPaid: number;
};

export async function listUsers(db: Db, query = "", limit = 100): Promise<UserRow[]> {
  const q = query.trim();
  // Qualified: inside a correlated subquery a bare "id" would be the subquery's own column.
  const uid = sql.raw(`"users"."id"`);
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      offersOptIn: users.offersOptIn,
      savedProducts:
        sql<number>`(select count(*) from saved_items s where s.user_id = ${uid} and s.kind = 'product')`.mapWith(
          Number,
        ),
      savedSearches:
        sql<number>`(select count(*) from saved_items s where s.user_id = ${uid} and s.kind = 'search')`.mapWith(
          Number,
        ),
      subscribed: sql<boolean>`exists (select 1 from subscriptions b where b.user_id = ${uid} and b.status in ('active', 'past_due'))`,
      offersSent:
        sql<number>`(select count(*) from special_offers o where o.user_id = ${uid} and o.status <> 'draft')`.mapWith(
          Number,
        ),
      ordersPaid:
        sql<number>`(select count(*) from offer_orders r where r.user_id = ${uid} and r.paid_at is not null)`.mapWith(
          Number,
        ),
    })
    .from(users)
    .where(q ? or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`)) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, subscribed: !!r.subscribed }));
}

export async function userDetail(db: Db, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  const saved = await db
    .select()
    .from(savedItems)
    .where(eq(savedItems.userId, userId))
    .orderBy(desc(savedItems.createdAt));
  const productIds = saved.filter((s) => s.productId).map((s) => s.productId!);
  const products = new Map((await loadProducts(db, productIds)).map((p) => [p.id, p]));
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  const offerRows = await db
    .select({ offer: specialOffers, order: offerOrders })
    .from(specialOffers)
    .leftJoin(offerOrders, eq(offerOrders.offerId, specialOffers.id))
    .where(eq(specialOffers.userId, userId))
    .orderBy(desc(specialOffers.createdAt));
  return {
    user,
    subscription: sub ?? null,
    savedProducts: saved
      .filter((s) => s.kind === "product" && s.productId && products.has(s.productId))
      .map((s) => {
        const product = products.get(s.productId!)!;
        const best = currentOffer(product);
        return { item: s, product, best };
      }),
    savedSearches: saved.filter((s) => s.kind === "search"),
    offers: offerRows,
  };
}

// ---------------------------------------------------------------- Pieprasījums

/** Everyone who saved a product, with consent, for "Piedāvāt visiem". */
export async function saversOf(db: Db, productId: string) {
  return db
    .select({ id: users.id, email: users.email, name: users.name, optIn: users.offersOptIn })
    .from(savedItems)
    .innerJoin(users, eq(users.id, savedItems.userId))
    .where(and(eq(savedItems.kind, "product"), eq(savedItems.productId, productId)));
}

// ---------------------------------------------------------------- Piedāvājumi and pasūtījumi

// ---------------------------------------------------------------- Sistēma

export async function lastRuns(db: Db) {
  const rows = await db
    .select({
      storeId: stores.id,
      storeName: stores.displayName,
      slug: stores.slug,
      active: stores.active,
      feedType: stores.feedType,
      startedAt: ingestionRuns.startedAt,
      finishedAt: ingestionRuns.finishedAt,
      ok: ingestionRuns.ok,
      rowsUpserted: ingestionRuns.rowsUpserted,
      rowsRejected: ingestionRuns.rowsRejected,
      error: ingestionRuns.error,
    })
    .from(stores)
    .leftJoin(
      ingestionRuns,
      sql`${ingestionRuns.id} = (select r.id from ingestion_runs r where r.store_id = "stores"."id" order by r.started_at desc limit 1)`,
    )
    .orderBy(stores.displayName);
  return rows.filter((r) => r.active);
}

export async function eprelCounts(db: Db) {
  const rows = await db
    .select({ status: eprelLookups.status, n: count() })
    .from(eprelLookups)
    .groupBy(eprelLookups.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}

/** Retry EPREL lookups that failed: the job asks again for products without a lookup row. */
export async function retryEprelErrors(db: Db): Promise<number> {
  const rows = await db
    .delete(eprelLookups)
    .where(eq(eprelLookups.status, "error"))
    .returning({ id: eprelLookups.productId });
  return rows.length;
}

export async function ordersNeedingDelivery(db: Db) {
  return db
    .select({ order: offerOrders })
    .from(offerOrders)
    .where(and(eq(offerOrders.status, "shipped"), isNull(offerOrders.deliveredAt)));
}

/**
 * "Pārliecība" (docs/CONFIDENCE_PLAN.md §3 E): of the results views in the
 * period, how many ended in a click to a shop, and what shoppers answered to
 * "Vai šie varianti deva pārliecību izvēlēties?", with the latest notes.
 */
export async function confidenceStats(db: Db, from: string, to: string) {
  const inRange = (col: typeof searchSessions.createdAt | typeof confidenceAnswers.createdAt) =>
    sql`${col} >= ${rigaStart(from)} and ${col} < ${rigaEnd(to)}`;
  const [views] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(searchSessions)
    .where(inRange(searchSessions.createdAt));
  const [clicked] = await db
    .select({ n: sql<number>`count(distinct ${affiliateClicks.searchSessionId})::int` })
    .from(affiliateClicks)
    .innerJoin(searchSessions, eq(searchSessions.id, affiliateClicks.searchSessionId))
    .where(inRange(searchSessions.createdAt));
  const answers = await db
    .select({ confident: confidenceAnswers.confident, n: sql<number>`count(*)::int` })
    .from(confidenceAnswers)
    .where(inRange(confidenceAnswers.createdAt))
    .groupBy(confidenceAnswers.confident);
  const notes = await db
    .select({
      subcategoryId: confidenceAnswers.subcategoryId,
      note: confidenceAnswers.note,
      at: confidenceAnswers.createdAt,
    })
    .from(confidenceAnswers)
    .where(and(inRange(confidenceAnswers.createdAt), sql`${confidenceAnswers.note} is not null`))
    .orderBy(desc(confidenceAnswers.createdAt))
    .limit(10);
  const yes = answers.find((a) => a.confident)?.n ?? 0;
  const no = answers.find((a) => !a.confident)?.n ?? 0;
  const v = views?.n ?? 0;
  const c = clicked?.n ?? 0;
  return {
    views: v,
    clicked: c,
    clickShare: v ? c / v : null,
    yes,
    no,
    yesShare: yes + no ? yes / (yes + no) : null,
    notes,
  };
}
