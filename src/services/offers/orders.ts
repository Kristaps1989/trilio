import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  invoices,
  offerEvents,
  offerOrders,
  payments,
  specialOffers,
  type Invoice,
  type OfferOrder,
  type SpecialOffer,
} from "@/db/schema";
import { companyFromEnv, type Company } from "@/config/company";
import type { OrderForm } from "@/domain/offers/checkout";
import {
  canAccept,
  canMove,
  invoiceNumber,
  orderNumber,
  trackingUrl,
  vatRateFor,
  vatSplit,
  type OrderStatus,
} from "@/domain/offers/offers";
import type { PaymentEvent, PaymentProvider } from "@/services/payments/types";

/** The free delivery line on every invoice, stored in Latvian (the invoice language); shown translated. */
export const DELIVERY_LINE = "Piegāde Latvijā";

// Orders for personal offers (docs/ADMIN_AND_OFFERS_PLAN.md §5, §9, §10).
// Trilio is the seller: a paid order gets an invoice from Trilio's own
// series, every step is an event on the timeline both sides see, and a
// refund issues a credit note.

const DUPLICATE = "23505";
/** Unique violation; drizzle wraps the driver's error in `cause`. */
const isDuplicate = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === DUPLICATE || e?.cause?.code === DUPLICATE;
};

export async function orderById(db: Db, id: string): Promise<OfferOrder | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(offerOrders).where(eq(offerOrders.id, id));
  return row ?? null;
}

export async function orderOfOffer(db: Db, offerId: string): Promise<OfferOrder | null> {
  const [row] = await db.select().from(offerOrders).where(eq(offerOrders.offerId, offerId));
  return row ?? null;
}

export async function ordersOfUser(db: Db, userId: string) {
  return db
    .select({ order: offerOrders, offer: specialOffers })
    .from(offerOrders)
    .innerJoin(specialOffers, eq(specialOffers.id, offerOrders.offerId))
    .where(eq(offerOrders.userId, userId))
    .orderBy(desc(offerOrders.createdAt));
}

export async function orderWithOffer(db: Db, orderId: string) {
  const order = await orderById(db, orderId);
  if (!order) return null;
  const [offer] = await db.select().from(specialOffers).where(eq(specialOffers.id, order.offerId));
  return offer ? { order, offer } : null;
}

export type PlaceResult =
  { ok: true; order: OfferOrder } | { ok: false; reason: "closed" | "not_yours" | "already_paid" };

/**
 * "Apmaksāt": the buyer accepted and filled in the form. Re-submitting
 * before paying updates the same order; the price is the offer's.
 */
export async function placeOrder(
  db: Db,
  offer: SpecialOffer,
  buyer: { userId: string; email: string },
  form: OrderForm,
  now = new Date(),
): Promise<PlaceResult> {
  if (offer.userId !== buyer.userId) return { ok: false, reason: "not_yours" };
  if (!canAccept(offer, now)) return { ok: false, reason: "closed" };
  const existing = await orderOfOffer(db, offer.id);
  if (existing && existing.status !== "awaiting_payment") return { ok: false, reason: "already_paid" };

  const fields = {
    ...form,
    email: buyer.email,
    userId: buyer.userId,
    amountCents: offer.priceCents,
    termsAcceptedAt: now,
    updatedAt: now,
  };
  let order: OfferOrder | undefined;
  if (existing) {
    [order] = await db.update(offerOrders).set(fields).where(eq(offerOrders.id, existing.id)).returning();
  } else {
    for (let attempt = 0; !order && attempt < 5; attempt++) {
      try {
        [order] = await db
          .insert(offerOrders)
          .values({
            ...fields,
            offerId: offer.id,
            number: orderNumber((n) => randomBytes(n)),
            feedbackToken: randomBytes(24).toString("base64url"),
          })
          .returning();
      } catch (err) {
        if (!isDuplicate(err)) throw err;
        const raced = await orderOfOffer(db, offer.id);
        if (raced) return placeOrder(db, offer, buyer, form, now);
      }
    }
  }
  if (!order) throw new Error("could not number the order");
  if (offer.status !== "accepted")
    await db
      .update(specialOffers)
      .set({ status: "accepted", acceptedAt: now })
      .where(eq(specialOffers.id, offer.id));
  await db.insert(offerEvents).values({
    offerId: offer.id,
    orderId: order.id,
    kind: existing ? "details_updated" : "accepted",
    source: "buyer",
  });
  return { ok: true, order };
}

function paymentOrderId(order: OfferOrder): string {
  return `TRILIO-${order.number.replace(/-/g, "")}-${Date.now().toString(36)}`;
}

/** The hosted payment page for an order (Paysera; the mock in development and CI). */
export async function startOrderPayment(
  db: Db,
  provider: PaymentProvider,
  order: OfferOrder,
  offer: SpecialOffer,
  urls: { acceptUrl: string; cancelUrl: string; callbackUrl: string },
  locale = "lv",
): Promise<string | null> {
  const oid = paymentOrderId(order);
  const [payment] = await db
    .insert(payments)
    .values({ offerOrderId: order.id, orderId: oid, kind: "order", amountCents: order.amountCents })
    .returning();
  const created = await provider.createPayment({
    orderId: oid,
    amountCents: order.amountCents,
    currency: "EUR",
    description: `Trilio ${order.number}: ${offer.productName}`.slice(0, 120),
    payerEmail: order.email,
    locale,
    ...urls,
    requestToken: false,
  });
  await db
    .update(payments)
    .set({ providerRequestId: created.providerRequestId })
    .where(eq(payments.id, payment!.id));
  return created.redirectUrl;
}

/**
 * A verified capture for an order payment. Idempotent: a second capture of
 * the same order changes nothing. Issues the invoice.
 */
export async function orderPaymentCaptured(
  db: Db,
  payment: typeof payments.$inferSelect,
  event: PaymentEvent,
  now = new Date(),
  company: Company = companyFromEnv(),
): Promise<"order_paid" | "ignored"> {
  if (!payment.offerOrderId) return "ignored";
  const order = await orderById(db, payment.offerOrderId);
  if (!order) return "ignored";
  if (event.amountCents !== null && event.amountCents !== payment.amountCents) {
    await db
      .update(payments)
      .set({ status: "failed", error: "amount_mismatch" })
      .where(eq(payments.id, payment.id));
    return "ignored";
  }
  await db
    .update(payments)
    .set({ status: "captured", paidAt: now, providerRequestId: event.providerRequestId })
    .where(eq(payments.id, payment.id));
  if (order.status !== "awaiting_payment") return "ignored";
  await db
    .update(offerOrders)
    .set({ status: "paid", paidAt: now, updatedAt: now })
    .where(eq(offerOrders.id, order.id));
  await db.update(specialOffers).set({ status: "paid" }).where(eq(specialOffers.id, order.offerId));
  await db.insert(offerEvents).values({
    offerId: order.offerId,
    orderId: order.id,
    kind: "paid",
    source: "system",
    data: { method: event.paymentMethodLabel, test: event.test ?? false },
  });
  await issueInvoice(db, order.id, now, company);
  return "order_paid";
}

// ---------------------------------------------------------------- invoices

function buyerOf(order: OfferOrder): Record<string, string> {
  const address =
    order.deliveryMethod === "locker"
      ? (order.lockerName ?? "")
      : [order.street, order.city, order.postcode].filter(Boolean).join(", ");
  if (order.buyerKind === "company")
    return {
      kind: "company",
      name: order.companyName ?? order.fullName,
      regNo: order.companyRegNo ?? "",
      vatNo: order.companyVatNo ?? "",
      address: order.legalAddress || address,
      contact: order.fullName,
      email: order.email,
    };
  return { kind: "person", name: order.fullName, address, email: order.email };
}

async function nextSeq(db: Db, year: number): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${invoices.seq})` })
    .from(invoices)
    .where(eq(invoices.year, year));
  return Number(row?.max ?? 0) + 1;
}

async function insertNumbered(
  db: Db,
  values: Omit<typeof invoices.$inferInsert, "number" | "year" | "seq">,
  now: Date,
): Promise<Invoice> {
  const year = now.getFullYear();
  for (let attempt = 0; attempt < 8; attempt++) {
    const seq = await nextSeq(db, year);
    try {
      const [row] = await db
        .insert(invoices)
        .values({ ...values, year, seq, number: invoiceNumber(year, seq), issuedAt: now })
        .returning();
      return row!;
    } catch (err) {
      if (!isDuplicate(err)) throw err;
    }
  }
  throw new Error("could not number the invoice");
}

export async function invoicesOf(db: Db, orderId: string): Promise<Invoice[]> {
  return db.select().from(invoices).where(eq(invoices.orderId, orderId)).orderBy(invoices.seq);
}

/** The invoice for a paid order, once. VAT applies when Trilio is registered at issue time. */
export async function issueInvoice(
  db: Db,
  orderId: string,
  now = new Date(),
  company: Company = companyFromEnv(),
): Promise<Invoice | null> {
  const existing = (await invoicesOf(db, orderId)).find((i) => i.kind === "invoice");
  if (existing) return existing;
  const found = await orderWithOffer(db, orderId);
  if (!found) return null;
  const { order, offer } = found;
  const vatRate = vatRateFor(company.vatNo);
  const split = vatSplit(order.amountCents, vatRate);
  const condition = offer.condition === "refurbished" ? ` (atjaunota, ${offer.grade ?? ""})` : "";
  return insertNumbered(
    db,
    {
      kind: "invoice",
      orderId,
      seller: {
        name: company.name,
        regNo: company.regNo,
        vatNo: company.vatNo,
        address: company.address,
        email: company.email,
      },
      buyer: buyerOf(order),
      lines: [
        { text: `${offer.productName}${condition}`, quantity: 1, totalCents: order.amountCents },
        { text: DELIVERY_LINE, quantity: 1, totalCents: 0 },
      ],
      netCents: split.netCents,
      vatCents: split.vatCents,
      totalCents: split.totalCents,
      vatRate,
    },
    now,
  );
}

/** A refund reverses the invoice with a credit note in the same series. */
export async function issueCreditNote(db: Db, orderId: string, now = new Date()): Promise<Invoice | null> {
  const list = await invoicesOf(db, orderId);
  const original = list.find((i) => i.kind === "invoice");
  if (!original) return null;
  const existing = list.find((i) => i.kind === "credit_note");
  if (existing) return existing;
  return insertNumbered(
    db,
    {
      kind: "credit_note",
      orderId,
      creditForId: original.id,
      seller: original.seller,
      buyer: original.buyer,
      lines: original.lines.map((l) => ({ ...l, totalCents: -l.totalCents })),
      netCents: -original.netCents,
      vatCents: -original.vatCents,
      totalCents: -original.totalCents,
      vatRate: original.vatRate,
    },
    now,
  );
}

// ---------------------------------------------------------------- steps

export type OrderStep = {
  to: OrderStatus;
  by: "admin" | "buyer" | "carrier" | "system";
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  refundReference?: string;
  note?: string;
  at?: Date;
};

export type StepResult =
  | { ok: true; order: OfferOrder }
  | { ok: false; reason: "unknown" | "not_allowed" | "tracking" | "reference" };

/** One step on the timeline, with its timestamp; refused when the order cannot move that way. */
export async function moveOrder(db: Db, orderId: string, step: OrderStep): Promise<StepResult> {
  const order = await orderById(db, orderId);
  if (!order) return { ok: false, reason: "unknown" };
  if (!canMove(order.status, step.to)) return { ok: false, reason: "not_allowed" };
  const at = step.at ?? new Date();
  const set: Partial<typeof offerOrders.$inferInsert> = { status: step.to, updatedAt: at };
  switch (step.to) {
    case "packed":
      set.packedAt = at;
      break;
    case "shipped": {
      const number = step.trackingNumber?.trim() ?? "";
      if (!step.carrier || (!number && !step.trackingUrl)) return { ok: false, reason: "tracking" };
      set.shippedAt = at;
      set.carrier = step.carrier;
      set.trackingNumber = number || null;
      set.trackingUrl = step.trackingUrl?.trim() || trackingUrl(step.carrier, number);
      break;
    }
    case "delivered":
      set.deliveredAt = at;
      set.deliveryConfirmedBy = step.by;
      break;
    case "return_requested":
      set.returnRequestedAt = at;
      break;
    case "returned":
      set.returnedAt = at;
      break;
    case "refunded":
      if (!step.refundReference?.trim()) return { ok: false, reason: "reference" };
      set.refundedAt = at;
      set.refundReference = step.refundReference.trim();
      break;
  }
  const [updated] = await db
    .update(offerOrders)
    .set(set)
    .where(and(eq(offerOrders.id, order.id), eq(offerOrders.status, order.status)))
    .returning();
  if (!updated) return { ok: false, reason: "not_allowed" };
  await db.insert(offerEvents).values({
    offerId: order.offerId,
    orderId: order.id,
    kind: step.to,
    source: step.by,
    note: step.note ?? null,
    data:
      step.to === "shipped"
        ? { carrier: set.carrier, trackingNumber: set.trackingNumber, trackingUrl: set.trackingUrl }
        : step.to === "refunded"
          ? { reference: set.refundReference }
          : null,
    createdAt: at,
  });
  if (step.to === "refunded") await issueCreditNote(db, order.id, at);
  return { ok: true, order: updated };
}

/** The admin corrects the delivery date (e.g. the buyer pressed "Saņēmu preci" late). Audited by the caller. */
export async function correctDeliveredAt(db: Db, orderId: string, deliveredAt: Date, by: string) {
  const order = await orderById(db, orderId);
  if (!order?.deliveredAt) return false;
  await db.update(offerOrders).set({ deliveredAt, updatedAt: new Date() }).where(eq(offerOrders.id, orderId));
  await db.insert(offerEvents).values({
    offerId: order.offerId,
    orderId,
    kind: "delivery_corrected",
    source: "admin",
    note: by,
    data: { from: order.deliveredAt.toISOString(), to: deliveredAt.toISOString() },
  });
  return true;
}

export async function addOrderNote(db: Db, orderId: string, note: string, by: string) {
  const order = await orderById(db, orderId);
  if (!order || !note.trim()) return false;
  await db.insert(offerEvents).values({
    offerId: order.offerId,
    orderId,
    kind: "note",
    source: "admin",
    note: note.trim().slice(0, 1000),
    data: { by },
  });
  return true;
}

// ---------------------------------------------------------------- after delivery

export async function orderByFeedbackToken(db: Db, value: string): Promise<OfferOrder | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return null;
  const [row] = await db.select().from(offerOrders).where(eq(offerOrders.feedbackToken, value));
  return row ?? null;
}

/** "Viss kārtībā" / "Ir problēma" (§11.6): one answer, a problem may carry a note. */
export async function recordFeedback(
  db: Db,
  order: OfferOrder,
  answer: "ok" | "problem",
  note: string | null,
): Promise<boolean> {
  if (order.feedback) return false;
  await db
    .update(offerOrders)
    .set({ feedback: answer, feedbackNote: note?.trim().slice(0, 2000) || null, updatedAt: new Date() })
    .where(eq(offerOrders.id, order.id));
  await db.insert(offerEvents).values({
    offerId: order.offerId,
    orderId: order.id,
    kind: answer === "ok" ? "feedback_ok" : "feedback_problem",
    source: "buyer",
    note: note?.trim().slice(0, 2000) || null,
  });
  return true;
}
