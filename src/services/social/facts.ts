import { and, desc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loadCandidates, loadProducts } from "@/db/queries/catalog";
import { offerOrders, specialOffers } from "@/db/schema";
import { cleanName } from "@/domain/catalog/naming";
import { decodeState } from "@/domain/flow/state";
import { knowledgeOf } from "@/domain/knowledge/knowledge";
import { catalog, getSubcategory } from "@/domain/questions/catalog";
import { rank } from "@/domain/ranking/rank";
import { offerStory } from "@/domain/social/anonymise";
import { composePost, type PostFacts } from "@/domain/social/captions";
import {
  MIN_CATEGORY_VIEWS,
  MIN_DROP_PERCENT,
  MIN_PRODUCT_INTEREST,
  rigaDayOf,
} from "@/domain/social/schedule";
import { currentOffer, rankInputFromState } from "@/domain/wishlist/wishlist";
import { currentMarket } from "@/i18n/market";
import { visitRows } from "@/services/visits/visits";

// The facts a post is made from (docs/SOCIAL_PLAN.md §3): live prices from
// the partner feeds, aggregated counts from the cookieless statistics, and
// the allowed fields of a paid offer. A shop whose feed is older than a day
// is left out, so a post never shows a price the shop no longer has.

const FRESH_MS = 24 * 3600 * 1000;
const PAID = ["paid", "packed", "shipped", "delivered"] as const;

export const categoryLabel = (id: string) => getSubcategory(id)?.label ?? id;

/** The flow's first question for a category: "a few questions, then three". */
export function flowPath(subcategoryId: string): string {
  const g = catalog.groups.find((x) => x.subcategories.some((s) => s.id === subcategoryId));
  return g ? `/izvelies/${g.id}/${subcategoryId}` : "/";
}

export const knownCategories = () => new Set(catalog.groups.flatMap((g) => g.subcategories.map((s) => s.id)));

const fresh = (d: Date | null | undefined, now: Date) => !!d && now.getTime() - d.getTime() < FRESH_MS;

/** Results views per category in the last 7 days, most first. */
export async function categoriesByTraffic(db: Db, now: Date): Promise<{ id: string; views: number }[]> {
  const from = rigaDayOf(new Date(now.getTime() - 6 * 86_400_000));
  const rows = await visitRows(db, from, rigaDayOf(now), now);
  const views = new Map<string, number>();
  for (const r of rows)
    if (r.section === "results" && r.subcategory)
      views.set(r.subcategory, (views.get(r.subcategory) ?? 0) + r.views);
  const known = knownCategories();
  return [...views]
    .filter(([id]) => known.has(id))
    .map(([id, v]) => ({ id, views: v }))
    .sort((a, b) => b.views - a.views);
}

/** Type A: the three picks for a category with its default answers, at today's prices. */
export async function picksFacts(db: Db, subcategoryId: string, now: Date): Promise<PostFacts | null> {
  const sub = getSubcategory(subcategoryId);
  if (!sub) return null;
  const products = await loadCandidates(db, subcategoryId);
  const r = rank(rankInputFromState(products, sub, decodeState(sub, null)));
  const picks = r.picks.filter((p) => fresh(p.offer.lastSeenAt, now)).slice(0, 3);
  if (picks.length < 2) return null;
  return {
    kind: "picks",
    subcategoryId,
    category: sub.label,
    // The flow's first plain questions (no conditional ones), worded as the site asks them.
    questions: sub.questions
      .filter(
        (q) =>
          q.stage === "flow" &&
          !q.showIf &&
          (q.type === "single" || q.type === "multi") &&
          q.options.length >= 2,
      )
      .slice(0, 3)
      .map((q) => ({ title: q.title, options: q.options.map((o) => o.label) })),
    picks: picks.map((p) => ({
      name: cleanName(p.product.name, p.product.brand, p.product.modelCode),
      priceCents: p.offer.priceCents,
      shop: p.offer.storeName,
    })),
    path: flowPath(subcategoryId),
  };
}

/** Type B: the deepest real drop below an offer's own 30-day low (Omnibus), not posted lately. */
export async function priceDropFacts(
  db: Db,
  now: Date,
  exclude: string[],
  only?: string,
): Promise<PostFacts | null> {
  const since = new Date(now.getTime() - FRESH_MS);
  const result = await db.execute(sql`
    select o.product_id as "productId", p.name, p.brand, p.model_code as "modelCode",
           p.subcategory_id as "subcategoryId", s.display_name as shop,
           o.price_cents as "priceCents", low.low as "lowCents"
      from offers o
      join stores s on s.id = o.store_id
      join products p on p.id = o.product_id
      join lateral (
        select min(ps.price_cents) as low from price_snapshots ps
         where ps.offer_id = o.id and ps.captured_at >= ${now.toISOString()}::timestamptz - interval '30 days'
           and ps.price_cents <> o.price_cents
      ) low on true
     where s.active and s.country = ${currentMarket().country}
       and o.condition = 'new' and o.stock = 'in' and o.last_seen_at >= ${since.toISOString()}::timestamptz
       and low.low is not null
       and o.price_cents * 100 <= low.low * ${100 - MIN_DROP_PERCENT}
       ${only ? sql`and o.product_id = ${only}` : sql``}
     order by (low.low - o.price_cents)::float / low.low desc
     limit 20`);
  const rows = result as unknown as {
    productId: string;
    name: string;
    brand: string;
    modelCode: string;
    subcategoryId: string;
    shop: string;
    priceCents: number;
    lowCents: number;
  }[];
  const known = knownCategories();
  const r = rows.find((x) => !exclude.includes(x.productId) && known.has(x.subcategoryId));
  if (!r) return null;
  return {
    kind: "price_drop",
    subcategoryId: r.subcategoryId,
    productId: r.productId,
    product: cleanName(r.name, r.brand, r.modelCode),
    priceCents: Number(r.priceCents),
    lowCents: Number(r.lowCents),
    shop: r.shop,
    path: flowPath(r.subcategoryId),
  };
}

/**
 * Type C: one deciding factor from data/knowledge.json, a different one each
 * time. A factor written for the site in the "tu" form is passed over: posts
 * do not address the reader (docs/SOCIAL_PLAN.md §6).
 */
export function adviceFacts(subcategoryId: string, turn: number): PostFacts | null {
  const decides = knowledgeOf(subcategoryId).decides;
  for (let i = 0; i < decides.length; i++) {
    const d = decides[(turn + i) % decides.length]!;
    const f: PostFacts = {
      kind: "advice",
      subcategoryId,
      category: categoryLabel(subcategoryId),
      factor: d.why.lv,
      path: flowPath(subcategoryId),
    };
    if (!composePost(f, { postId: "check", baseUrl: "" }).issues.length) return f;
  }
  return null;
}

/**
 * Type D: the newest paid order not yet told. Returns the post facts and,
 * separately, the person's values, only for the leak check before saving.
 */
export async function paidOfferFacts(
  db: Db,
  usedOfferIds: string[],
): Promise<{ facts: PostFacts; personal: (string | null)[] } | null> {
  const [row] = await db
    .select({ o: specialOffers, order: offerOrders })
    .from(specialOffers)
    .innerJoin(offerOrders, eq(offerOrders.offerId, specialOffers.id))
    .where(
      and(
        inArray(offerOrders.status, [...PAID]),
        isNotNull(offerOrders.paidAt),
        usedOfferIds.length ? notInArray(specialOffers.id, usedOfferIds) : undefined,
      ),
    )
    .orderBy(desc(offerOrders.paidAt))
    .limit(1);
  if (!row) return null;
  const story = offerStory({ ...row.o, paidAt: row.order.paidAt! });
  return {
    facts: {
      kind: "offer",
      specialOfferId: row.o.id,
      subcategoryId: row.o.subcategoryId,
      product: cleanName(story.product),
      shop: story.shop,
      shopPriceCents: story.shopPriceCents,
      trilioPriceCents: story.trilioPriceCents,
      deliveryDays: story.deliveryDays,
      month: story.month,
      path: flowPath(row.o.subcategoryId),
    },
    personal: [
      row.order.fullName,
      row.order.email,
      row.order.phone,
      row.order.number,
      row.order.street,
      row.order.city,
      row.order.postcode,
      row.order.lockerName,
      row.order.deliveryNote,
      row.order.companyName,
      row.order.companyRegNo,
      row.order.companyVatNo,
      row.order.legalAddress,
      row.order.trackingNumber,
      row.o.token,
      row.o.message,
    ],
  };
}

/** Type E: the five most-viewed categories, when the first clears the threshold. */
export async function topCategoriesFacts(db: Db, now: Date): Promise<PostFacts | null> {
  const top = (await categoriesByTraffic(db, now)).slice(0, 5);
  if (top.length < 3 || (top[0]?.views ?? 0) < MIN_CATEGORY_VIEWS) return null;
  return {
    kind: "top_categories",
    categories: top.map((c) => ({ id: c.id, label: categoryLabel(c.id) })),
    path: "/",
  };
}

/** Type F: the products shoppers clicked to a shop or saved most this week, above the threshold. */
export async function topProductsFacts(db: Db, now: Date): Promise<PostFacts | null> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const result = await db.execute(sql`
    select product_id as "productId", sum(n)::int as n from (
      select o.product_id, count(distinct (ac.visitor_hash, date(ac.clicked_at)))::int as n
        from affiliate_clicks ac join offers o on o.id = ac.offer_id
       where ac.clicked_at >= ${since.toISOString()}::timestamptz and ac.visitor_hash is not null
       group by o.product_id
      union all
      select si.product_id, count(*)::int from saved_items si
       where si.created_at >= ${since.toISOString()}::timestamptz and si.product_id is not null
       group by si.product_id
    ) x group by product_id order by n desc limit 10`);
  const ranked = (result as unknown as { productId: string; n: number }[]).filter(
    (r) => Number(r.n) >= MIN_PRODUCT_INTEREST,
  );
  if (!ranked.length) return null;
  const byId = new Map(
    (
      await loadProducts(
        db,
        ranked.map((r) => r.productId),
      )
    ).map((p) => [p.id, p]),
  );
  const products = ranked
    .map((r) => byId.get(r.productId))
    .flatMap((p) => {
      const o = p ? currentOffer(p) : null;
      return p && o && fresh(o.lastSeenAt, now)
        ? [
            {
              id: p.id,
              name: cleanName(p.name, p.brand, p.modelCode),
              priceCents: o.priceCents,
              shop: o.storeName,
              sub: p.subcategoryId,
            },
          ]
        : [];
    })
    .slice(0, 3);
  if (products.length < 2) return null;
  return {
    kind: "top_products",
    products: products.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents, shop: p.shop })),
    path: flowPath(products[0]!.sub),
  };
}
