import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  leadNotes,
  offerEvents,
  offerOrders,
  partnerRequests,
  products,
  savedItems,
  specialOffers,
  users,
  type PartnerRequest,
} from "@/db/schema";
import { loadProducts } from "@/db/queries/catalog";
import { priceHistory } from "@/db/queries/wishlist";
import {
  classifyLead,
  classifyOffer,
  classifyOrder,
  type PartnerMark,
  type PartnerStatus,
  type WorkItem,
  type WorkKind,
} from "@/domain/admin/crm";
import { isLate } from "@/domain/offers/offers";
import { currentOffer } from "@/domain/wishlist/wishlist";

// The CRM's data (docs/CRM_PLAN.md §6): leads, offers and orders as one list
// of WorkItem, with the product's model code and EAN, the partner mark and the
// classification from the domain. Trilio's volumes are hundreds of rows, so
// everything is read once and filtered in code; the queries stay simple.

type Product = { id: string; name: string; modelCode: string; ean: string | null; subcategoryId: string };

function mark(r: PartnerRequest | undefined): PartnerMark | null {
  if (!r) return null;
  return {
    status: r.status,
    partner: r.partner,
    ref: r.partnerOrderRef,
    costCents: r.costCents,
    at: r.createdAt,
  };
}

/** The newest partner request per product (product-level) and per order. */
async function partnerMarks(db: Db) {
  const rows = await db.select().from(partnerRequests).orderBy(desc(partnerRequests.createdAt));
  const byProduct = new Map<string, PartnerRequest>();
  const byOrder = new Map<string, PartnerRequest>();
  for (const r of rows) {
    if (r.orderId) {
      if (!byOrder.has(r.orderId)) byOrder.set(r.orderId, r);
    } else if (!byProduct.has(r.productId)) byProduct.set(r.productId, r);
  }
  return { byProduct, byOrder };
}

async function productsById(db: Db, ids: string[]): Promise<Map<string, Product>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      modelCode: products.modelCode,
      ean: products.ean,
      subcategoryId: products.subcategoryId,
    })
    .from(products)
    .where(inArray(products.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}

const productOf = (p: Product | undefined, fallback: { name: string; subcategoryId: string }) => ({
  id: p?.id ?? null,
  name: p?.name ?? fallback.name,
  modelCode: p?.modelCode ?? null,
  ean: p?.ean ?? null,
  subcategoryId: p?.subcategoryId ?? fallback.subcategoryId,
});

export async function leadItems(
  db: Db,
  marks?: Awaited<ReturnType<typeof partnerMarks>>,
): Promise<WorkItem[]> {
  const saved = await db
    .select({
      productId: savedItems.productId,
      total: sql<number>`count(*)::int`,
      optedIn: sql<number>`(count(*) filter (where ${users.offersOptIn}))::int`,
      first: sql<Date>`min(${savedItems.createdAt})`,
      last: sql<Date>`max(${savedItems.createdAt})`,
    })
    .from(savedItems)
    .innerJoin(users, eq(users.id, savedItems.userId))
    .where(and(eq(savedItems.kind, "product"), isNotNull(savedItems.productId)))
    .groupBy(savedItems.productId);
  const ids = saved.map((s) => s.productId!).filter(Boolean);
  if (ids.length === 0) return [];
  const offers = await db
    .select({
      productId: specialOffers.productId,
      open: sql<number>`(count(*) filter (where ${specialOffers.status} in ('draft','sent','opened','accepted')))::int`,
      paid: sql<number>`(count(*) filter (where ${specialOffers.status} = 'paid'))::int`,
      offered: sql<number>`(count(*) filter (where ${specialOffers.status} not in ('draft','cancelled')))::int`,
      last: sql<Date | null>`max(coalesce(${specialOffers.sentAt}, ${specialOffers.createdAt}))`,
    })
    .from(specialOffers)
    .where(inArray(specialOffers.productId, ids))
    .groupBy(specialOffers.productId);
  const byProduct = new Map(offers.map((o) => [o.productId, o]));
  const prods = await productsById(db, ids);
  const m = marks ?? (await partnerMarks(db));
  const out: WorkItem[] = [];
  for (const s of saved) {
    const p = prods.get(s.productId!);
    if (!p) continue;
    const o = byProduct.get(p.id);
    const partner = mark(m.byProduct.get(p.id));
    const c = classifyLead({
      firstSavedAt: new Date(s.first),
      lastSavedAt: new Date(s.last),
      openOffers: Number(o?.open ?? 0),
      paidOffers: Number(o?.paid ?? 0),
      lastOfferAt: o?.last ? new Date(o.last) : null,
      partner,
    });
    out.push({
      ...c,
      kind: "lead",
      id: p.id,
      href: `/admin/pieprasijums/${p.id}`,
      number: null,
      product: productOf(p, p),
      person: null,
      date: new Date(s.last),
      amountCents: null,
      partner,
      savers: {
        total: Number(s.total),
        optedIn: Number(s.optedIn),
        offered: Number(o?.offered ?? 0),
        bought: Number(o?.paid ?? 0),
      },
    });
  }
  return out;
}

export async function offerItems(
  db: Db,
  marks?: Awaited<ReturnType<typeof partnerMarks>>,
): Promise<WorkItem[]> {
  const rows = await db
    .select({ offer: specialOffers, email: users.email })
    .from(specialOffers)
    .leftJoin(users, eq(users.id, specialOffers.userId));
  const prods = await productsById(
    db,
    rows.map((r) => r.offer.productId).filter((x): x is string => !!x),
  );
  const m = marks ?? (await partnerMarks(db));
  return rows.map(({ offer, email }) => {
    const p = offer.productId ? prods.get(offer.productId) : undefined;
    const partner = offer.productId ? mark(m.byProduct.get(offer.productId)) : null;
    const c = classifyOffer({
      status: offer.status,
      createdAt: offer.createdAt,
      sentAt: offer.sentAt,
      openedAt: offer.openedAt,
      acceptedAt: offer.acceptedAt,
      partner,
    });
    return {
      ...c,
      kind: "offer" as const,
      id: offer.id,
      href: `/admin/piedavajumi/${offer.id}`,
      number: null,
      product: productOf(p, { name: offer.productName, subcategoryId: offer.subcategoryId }),
      person: email,
      date: offer.createdAt,
      amountCents: offer.priceCents,
      partner,
    };
  });
}

export async function orderItems(
  db: Db,
  now: Date,
  marks?: Awaited<ReturnType<typeof partnerMarks>>,
): Promise<WorkItem[]> {
  const rows = await db
    .select({ order: offerOrders, offer: specialOffers })
    .from(offerOrders)
    .innerJoin(specialOffers, eq(specialOffers.id, offerOrders.offerId));
  const resolved = new Set(
    (
      await db
        .select({ orderId: offerEvents.orderId })
        .from(offerEvents)
        .where(eq(offerEvents.kind, "problem_resolved"))
    ).map((r) => r.orderId),
  );
  const prods = await productsById(
    db,
    rows.map((r) => r.offer.productId).filter((x): x is string => !!x),
  );
  const m = marks ?? (await partnerMarks(db));
  return rows.map(({ order, offer }) => {
    const p = offer.productId ? prods.get(offer.productId) : undefined;
    const partner = mark(m.byOrder.get(order.id));
    const late = isLate(order, now);
    const c = classifyOrder({
      status: order.status,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      packedAt: order.packedAt,
      shippedAt: order.shippedAt,
      returnRequestedAt: order.returnRequestedAt,
      returnedAt: order.returnedAt,
      late,
      problemSince: order.feedback === "problem" && !resolved.has(order.id) ? order.updatedAt : null,
      partner,
    });
    const buyer = order.buyerKind === "company" ? (order.companyName ?? order.fullName) : order.fullName;
    return {
      ...c,
      kind: "order" as const,
      id: order.id,
      href: `/admin/pasutijumi/${order.id}`,
      number: order.number,
      product: productOf(p, { name: offer.productName, subcategoryId: offer.subcategoryId }),
      person: buyer,
      date: order.createdAt,
      amountCents: order.amountCents,
      partner,
      late,
      searchText: [order.email, order.phone, order.companyName, order.city, order.trackingNumber]
        .filter(Boolean)
        .join(" "),
    };
  });
}

/** Every work item of the given kinds. */
export async function workItems(db: Db, now = new Date(), kinds: WorkKind[] = ["lead", "offer", "order"]) {
  const marks = await partnerMarks(db);
  const parts = await Promise.all([
    kinds.includes("lead") ? leadItems(db, marks) : [],
    kinds.includes("offer") ? offerItems(db, marks) : [],
    kinds.includes("order") ? orderItems(db, now, marks) : [],
  ]);
  return parts.flat();
}

/** Today's best shop price and the 30-day low, for the leads on one page. */
export async function leadPrices(db: Db, productIds: string[]) {
  const list = await loadProducts(db, productIds);
  const out = new Map<
    string,
    { bestCents: number | null; bestStore: string | null; low30Cents: number | null }
  >();
  for (const p of list) {
    const best = currentOffer(p);
    const lows = (await priceHistory(db, p.id, 30)).map((h) => h.priceCents);
    if (best) lows.push(best.priceCents);
    out.set(p.id, {
      bestCents: best?.priceCents ?? null,
      bestStore: best?.storeName ?? null,
      low30Cents: lows.length ? Math.min(...lows) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- partner requests and notes

export type PartnerInput = {
  productId: string;
  orderId: string | null;
  status: PartnerStatus;
  partner: string | null;
  ref: string | null;
  costCents: number | null;
  note: string | null;
};

/** Records a partner request or its answer; on an order it also lands in the order's timeline. */
export async function addPartnerRequest(
  db: Db,
  input: PartnerInput,
  by: string,
): Promise<PartnerRequest | null> {
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) return null;
  let offerId: string | null = null;
  if (input.orderId) {
    const [order] = await db
      .select({ offerId: offerOrders.offerId })
      .from(offerOrders)
      .where(eq(offerOrders.id, input.orderId));
    if (!order) return null;
    offerId = order.offerId;
  }
  const [row] = await db
    .insert(partnerRequests)
    .values({
      productId: input.productId,
      orderId: input.orderId,
      status: input.status,
      partner: input.partner?.trim().slice(0, 100) || null,
      partnerOrderRef: input.ref?.trim().slice(0, 100) || null,
      costCents: input.costCents,
      note: input.note?.trim().slice(0, 1000) || null,
      createdBy: by,
    })
    .returning();
  if (offerId)
    await db.insert(offerEvents).values({
      offerId,
      orderId: input.orderId,
      kind: `partner_${input.status}`,
      source: "admin",
      note:
        [input.partner, input.ref ? `#${input.ref}` : null, input.note].filter(Boolean).join(" · ") || null,
      data: { by },
    });
  return row ?? null;
}

/** The history for a product's leads (orderId null) or for one order, newest first. */
export async function partnerHistory(db: Db, productId: string, orderId: string | null = null) {
  return db
    .select()
    .from(partnerRequests)
    .where(
      and(
        eq(partnerRequests.productId, productId),
        orderId ? eq(partnerRequests.orderId, orderId) : isNull(partnerRequests.orderId),
      ),
    )
    .orderBy(desc(partnerRequests.createdAt));
}

/** Partner names used before, for the free-text field's suggestions. */
export async function partnerNames(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ partner: partnerRequests.partner })
    .from(partnerRequests)
    .where(isNotNull(partnerRequests.partner));
  return rows
    .map((r) => r.partner!)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "lv"));
}

/** The newest confirmed cost for a product, to pre-fill the offer form. */
export async function confirmedCost(db: Db, productId: string): Promise<number | null> {
  const [row] = await db
    .select({ cost: partnerRequests.costCents })
    .from(partnerRequests)
    .where(
      and(
        eq(partnerRequests.productId, productId),
        eq(partnerRequests.status, "confirmed"),
        isNotNull(partnerRequests.costCents),
      ),
    )
    .orderBy(desc(partnerRequests.createdAt))
    .limit(1);
  return row?.cost ?? null;
}

export async function addLeadNote(db: Db, productId: string, note: string, by: string): Promise<boolean> {
  const text = note.trim().slice(0, 1000);
  if (!text) return false;
  const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
  if (!product) return false;
  await db.insert(leadNotes).values({ productId, note: text, createdBy: by });
  return true;
}

export async function leadNotesOf(db: Db, productId: string) {
  return db
    .select()
    .from(leadNotes)
    .where(eq(leadNotes.productId, productId))
    .orderBy(desc(leadNotes.createdAt));
}

/** One lead: who saved it (with consent) and every offer made for it. */
export async function leadRecord(db: Db, productId: string) {
  const [product] = await loadProducts(db, [productId]);
  if (!product) return null;
  const [savers, offers, notes, history, prices] = await Promise.all([
    db
      .select({
        userId: users.id,
        email: users.email,
        optIn: users.offersOptIn,
        savedAt: savedItems.createdAt,
        baselineCents: savedItems.baselinePriceCents,
      })
      .from(savedItems)
      .innerJoin(users, eq(users.id, savedItems.userId))
      .where(and(eq(savedItems.kind, "product"), eq(savedItems.productId, productId)))
      .orderBy(desc(savedItems.createdAt)),
    db
      .select({ offer: specialOffers, email: users.email })
      .from(specialOffers)
      .leftJoin(users, eq(users.id, specialOffers.userId))
      .where(eq(specialOffers.productId, productId))
      .orderBy(desc(specialOffers.createdAt)),
    leadNotesOf(db, productId),
    partnerHistory(db, productId),
    leadPrices(db, [productId]),
  ]);
  return { product, savers, offers, notes, history, prices: prices.get(productId) ?? null };
}
