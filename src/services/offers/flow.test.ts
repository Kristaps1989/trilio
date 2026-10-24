import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import {
  appFlags,
  invoices,
  offerEvents,
  offerOrders,
  payments,
  products,
  savedItems,
  specialOffers,
  stores,
  users,
} from "@/db/schema";
import { saveProduct } from "@/db/queries/wishlist";
import { gtinCheckDigit } from "@/domain/catalog/ean";
import { formatEur } from "@/i18n/format";
import type { OrderForm } from "@/domain/offers/checkout";
import { OFFERS_PAUSED, setFlag } from "@/services/admin/audit";
import { processPaymentEvent } from "@/services/billing/engine";
import { upsertOffers } from "@/services/ingestion/upsert";
import { memoryEmailSender } from "@/services/notify/email";
import { createMockProvider, mockComplete } from "@/services/payments/mock";
import { composeOrderEmail, sendReminder, type MailDeps } from "./emails";
import { userLang } from "./texts";
import { runOffersJob } from "./job";
import {
  afterAcceptedWithoutPayments,
  afterOrderPaid,
  afterProblemReported,
  afterWithdrawal,
} from "./notify";
import {
  cancelOffer,
  createOffers,
  ensureOffersToken,
  eventsOf,
  extendOffer,
  markOpened,
  offerById,
  offerByToken,
  offerSignIn,
  offersOfUser,
  offersOptIn,
  previewOffer,
  sendOffer,
  setOffersOptIn,
  unsubscribeByToken,
  type OfferInput,
} from "./offers";
import {
  addOrderNote,
  correctDeliveredAt,
  invoicesOf,
  issueCreditNote,
  issueInvoice,
  moveOrder,
  orderByFeedbackToken,
  orderById,
  orderOfOffer,
  ordersOfUser,
  orderWithOffer,
  placeOrder,
  recordFeedback,
  startOrderPayment,
} from "./orders";
import { forgetBuyer } from "./privacy";
import { referenceFor } from "./reference";
import type { CarrierTracker } from "./tracking";

// Integration (docs/ADMIN_AND_OFFERS_PLAN.md): an offer goes from draft to a
// paid, shipped, delivered and refunded order, with consent, the one-time
// link sign-in, the invoice series, the e-mails and the job around it.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const KETTLE_EAN = "990000000777" + gtinCheckDigit("990000000777");
const FRIDGE_EAN = "990000000778" + gtinCheckDigit("990000000778");
const DAY = 24 * 3600 * 1000;
const BASE = "https://trilio.test";

const form: OrderForm = {
  buyerKind: "person",
  fullName: "Anna Bērziņa",
  phone: "+371 20000000",
  street: "Brīvības iela 1",
  city: "Rīga",
  postcode: "LV-1050",
  deliveryMethod: "courier",
  lockerId: null,
  lockerName: null,
  carryIn: false,
  deliveryNote: "Zvanīt pie durvīm",
  companyName: null,
  companyRegNo: null,
  companyVatNo: null,
  legalAddress: null,
};

run("offers and orders", () => {
  let db: Db;
  let end: () => Promise<void>;
  let kettle: string;
  let fridge: string;
  let buyer: { id: string; email: string };
  let noConsent: { id: string; email: string };
  const mail = memoryEmailSender();
  const deps: MailDeps = { email: mail, baseUrl: BASE, signature: "Kristaps", inbox: "info@trilio.test" };
  const input = (over: Partial<OfferInput> = {}): OfferInput => ({
    productId: kettle,
    userIds: [buyer.id],
    priceCents: 3900,
    condition: "new",
    grade: null,
    warrantyMonths: 24,
    quantity: 1,
    deliveryWorkingDays: 3,
    validUntil: new Date(Date.now() + 7 * DAY),
    message: "Tikko atvests no noliktavas.",
    supplierNote: "Izplatītājs A",
    costCents: 2500,
    ...over,
  });

  beforeAll(async () => {
    const created = createDb(url);
    db = created.db;
    end = () => created.client.end();
    await cleanup();
    const [s] = await db
      .insert(stores)
      .values({ slug: "offers_flow_store", displayName: "Flow Store", feedType: "sample" })
      .returning();
    const row = (ean: string, sub: string, price: number) => ({
      externalId: `of-${ean}`,
      ean,
      brand: "FlowBrand",
      modelCode: `FB-${ean.slice(-3)}`,
      name: `FlowBrand ${sub}`,
      description: null,
      subcategoryId: sub,
      attributes: {},
      tags: [],
      specs: null,
      kwhYear: null,
      rating: 80,
      imageUrl: null,
      condition: "new" as const,
      grade: null,
      warrantyMonths: null,
      priceCents: price,
      stock: "in" as const,
      deliveryEtaDays: null,
      url: `https://example.invalid/${ean}`,
    });
    await upsertOffers(db, { id: s!.id }, [
      row(KETTLE_EAN, "kettle", 4500),
      row(FRIDGE_EAN, "fridge", 60000),
    ]);
    const list = await db
      .select()
      .from(products)
      .where(inArray(products.ean, [KETTLE_EAN, FRIDGE_EAN]));
    kettle = list.find((p) => p.ean === KETTLE_EAN)!.id;
    fridge = list.find((p) => p.ean === FRIDGE_EAN)!.id;
    const stamp = Date.now();
    const [a] = await db
      .insert(users)
      .values({ email: `offers-flow-a-${stamp}@example.invalid`, offersOptIn: true, name: "Anna" })
      .returning();
    const [b] = await db
      .insert(users)
      .values({ email: `offers-flow-b-${stamp}@example.invalid` })
      .returning();
    buyer = { id: a!.id, email: a!.email };
    noConsent = { id: b!.id, email: b!.email };
    await saveProduct(db, buyer.id, { productId: kettle, subcategoryId: "kettle", baselinePriceCents: 4900 });
  });

  async function cleanup() {
    const old = await db.select({ id: users.id }).from(users).where(like(users.email, "offers-flow-%"));
    const ids = old.map((u) => u.id);
    if (ids.length) {
      const offers = await db
        .select({ id: specialOffers.id })
        .from(specialOffers)
        .where(inArray(specialOffers.userId, ids));
      const offerIds = offers.map((o) => o.id);
      if (offerIds.length) {
        const orders = await db
          .select({ id: offerOrders.id })
          .from(offerOrders)
          .where(inArray(offerOrders.offerId, offerIds));
        const orderIds = orders.map((o) => o.id);
        if (orderIds.length) {
          await db.delete(invoices).where(inArray(invoices.orderId, orderIds));
          await db.delete(payments).where(inArray(payments.offerOrderId, orderIds));
          await db.delete(offerEvents).where(inArray(offerEvents.orderId, orderIds));
          await db.delete(offerOrders).where(inArray(offerOrders.id, orderIds));
        }
        await db.delete(specialOffers).where(inArray(specialOffers.id, offerIds));
      }
      await db.delete(users).where(inArray(users.id, ids));
    }
    await db.delete(products).where(inArray(products.ean, [KETTLE_EAN, FRIDGE_EAN]));
    await db.delete(stores).where(eq(stores.slug, "offers_flow_store"));
  }

  afterAll(async () => {
    await setFlag(db, OFFERS_PAUSED, null);
    await cleanup();
    await end();
  });

  it("references the shops' price and 30-day low", async () => {
    const ref = await referenceFor(db, kettle);
    expect(ref).toMatchObject({ priceCents: 4500, storeName: "Flow Store", low30Cents: 4500 });
    expect(await referenceFor(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("drafts only for people who opted in and refuses bad input", async () => {
    expect(await createOffers(db, input({ priceCents: 0 }), "admin@test")).toEqual({
      ok: false,
      reason: "price",
    });
    expect(await createOffers(db, input({ validUntil: new Date(Date.now() - 1) }), "admin@test")).toEqual({
      ok: false,
      reason: "validity",
    });
    expect(await createOffers(db, input({ userIds: [] }), "admin@test")).toEqual({
      ok: false,
      reason: "recipients",
    });
    expect(
      await createOffers(db, input({ productId: "00000000-0000-0000-0000-000000000000" }), "admin@test"),
    ).toEqual({ ok: false, reason: "product" });
    const none = await createOffers(db, input({ userIds: [noConsent.id] }), "admin@test");
    expect(none).toEqual({
      ok: true,
      offerIds: [],
      skipped: [{ userId: noConsent.id, reason: "no_consent" }],
    });
    const r = await createOffers(
      db,
      input({ userIds: [buyer.id, noConsent.id, "00000000-0000-0000-0000-000000000000"] }),
      "admin@test",
    );
    expect(r.ok && r.offerIds).toHaveLength(1);
    expect(r.ok && r.skipped.map((s) => s.reason).sort()).toEqual(["no_consent", "unknown"]);
    const offer = await offerById(db, (r as { offerIds: string[] }).offerIds[0]!);
    expect(offer).toMatchObject({
      status: "draft",
      referencePriceCents: 4500,
      referenceLow30Cents: 4500,
      batchId: null,
    });
  });

  it("sends a personal note with a one-click unsubscribe, and the preview is that e-mail", async () => {
    const [draft] = await offersOfUser(db, buyer.id);
    const preview = await previewOffer(db, draft!.id, { baseUrl: BASE, signature: "Kristaps" });
    await setFlag(db, OFFERS_PAUSED, "1");
    expect(await sendOffer(db, draft!.id, { ...deps, email: mail })).toEqual({ ok: false, reason: "paused" });
    await setFlag(db, OFFERS_PAUSED, null);
    const sent = await sendOffer(db, draft!.id, deps);
    expect(sent).toEqual({ ok: true, emailed: true });
    const msg = mail.sent.at(-1)!;
    expect(msg.to).toBe(buyer.email);
    expect(msg.subject).toBe(`Kristaps no Trilio: FlowBrand kettle par ${formatEur(3900)}`);
    expect(msg.text).toContain(`kad cena bija ${formatEur(4900)}`);
    expect(msg.text).toContain(`par ${formatEur(600)} lētāk nekā zemākā cena`);
    expect(msg.text).toContain("Tikko atvests no noliktavas.");
    expect(msg.text).toContain(`${BASE}/piedavajums/${draft!.token}`);
    expect(msg.headers?.["List-Unsubscribe"]).toMatch(/\/api\/offers\/unsubscribe\//);
    expect(msg.replyTo).toBeUndefined();
    expect(preview?.subject).toBe(msg.subject);
    expect(preview?.text.split("\n\n").slice(0, 4)).toEqual(msg.text.split("\n\n").slice(0, 4));
    expect(await sendOffer(db, draft!.id, deps)).toEqual({ ok: false, reason: "not_draft" });
    expect((await offerById(db, draft!.id))?.status).toBe("sent");
  });

  it("an e-mail service error keeps the draft; without consent nothing is sent", async () => {
    const r = await createOffers(db, input({ productId: fridge, priceCents: 55000 }), "admin@test");
    const id = (r as { offerIds: string[] }).offerIds[0]!;
    const failing = {
      ...deps,
      email: { send: async () => ({ ok: false as const, reason: "error" as const }) },
    };
    expect(await sendOffer(db, id, failing)).toEqual({ ok: false, reason: "email_failed" });
    const disabled = {
      ...deps,
      email: { send: async () => ({ ok: false as const, reason: "disabled" as const }) },
    };
    await setOffersOptIn(db, buyer.id, false);
    expect(await sendOffer(db, id, disabled)).toEqual({ ok: false, reason: "no_consent" });
    await setOffersOptIn(db, buyer.id, true);
    expect(await sendOffer(db, id, disabled)).toEqual({ ok: true, emailed: false });
    expect(await cancelOffer(db, id, "admin@test")).toBe(true);
    expect(await cancelOffer(db, id, "admin@test")).toBe(false);
    expect(await extendOffer(db, id, new Date(Date.now() + DAY), "admin@test")).toBe(false);
  });

  it("opening counts once; the link signs in once while the offer is open", async () => {
    const [offer] = (await offersOfUser(db, buyer.id)).filter((o) => o.status === "sent");
    await markOpened(db, offer!);
    await markOpened(db, (await offerById(db, offer!.id))!);
    expect((await offerById(db, offer!.id))?.status).toBe("opened");
    expect(await offerSignIn(db, "not-a-token")).toBeNull();
    expect(await offerSignIn(db, offer!.token)).toMatchObject({ id: buyer.id, email: buyer.email });
    expect(await offerSignIn(db, offer!.token)).toBeNull();
    const kinds = (await eventsOf(db, offer!.id)).map((e) => e.kind);
    expect(kinds).toEqual(["created", "sent", "opened", "signin"]);
    expect(await offerByToken(db, offer!.token)).toMatchObject({ id: offer!.id });
  });

  it("places, pays and invoices an order; a second capture changes nothing", async () => {
    const [offer] = (await offersOfUser(db, buyer.id)).filter((o) => o.status === "opened");
    expect(await placeOrder(db, offer!, { userId: noConsent.id, email: noConsent.email }, form)).toEqual({
      ok: false,
      reason: "not_yours",
    });
    const placed = await placeOrder(db, offer!, { userId: buyer.id, email: buyer.email }, form);
    expect(placed.ok).toBe(true);
    const again = await placeOrder(
      db,
      (await offerById(db, offer!.id))!,
      buyer && { userId: buyer.id, email: buyer.email },
      {
        ...form,
        phone: "+371 29999999",
      },
    );
    expect(again.ok && again.order.id).toBe(placed.ok && placed.order.id);
    const order = (again as { order: { id: string; number: string; amountCents: number } }).order;
    expect(order.number).toMatch(/^T-[2-9A-Z]{6}$/);
    expect(order.amountCents).toBe(3900);
    expect((await offerById(db, offer!.id))?.status).toBe("accepted");

    const provider = createMockProvider(BASE);
    const full = (await orderById(db, order.id))!;
    const redirect = await startOrderPayment(db, provider, full, offer!, {
      acceptUrl: `${BASE}/ok`,
      cancelUrl: `${BASE}/cancel`,
      callbackUrl: `${BASE}/cb`,
    });
    expect(redirect).toContain("/maksajums/mock");
    const [payment] = await db.select().from(payments).where(eq(payments.offerOrderId, order.id));
    expect(payment).toMatchObject({ kind: "order", subscriptionId: null, amountCents: 3900 });
    const notification = mockComplete(payment!.providerRequestId!)!;
    const event = (await provider.fetchEvent({
      body: `notification_id=${notification}`,
      headers: new Headers(),
    }))!;
    expect(await processPaymentEvent(db, provider, event)).toBe("order_paid");
    expect(await processPaymentEvent(db, provider, event)).toBe("duplicate");
    expect(await processPaymentEvent(db, provider, { ...event, notificationId: `${notification}-2` })).toBe(
      "ignored",
    );

    const paid = await orderWithOffer(db, order.id);
    expect(paid?.order).toMatchObject({ status: "paid", phone: "+371 29999999" });
    expect(paid?.offer.status).toBe("paid");
    const [invoice] = await invoicesOf(db, order.id);
    expect(invoice).toMatchObject({
      kind: "invoice",
      vatRate: null,
      netCents: 3900,
      vatCents: 0,
      totalCents: 3900,
    });
    expect(invoice!.number).toMatch(/^TR-\d{4}-\d{4}$/);
    expect(invoice!.buyer).toMatchObject({
      kind: "person",
      name: "Anna Bērziņa",
      address: "Brīvības iela 1, Rīga, LV-1050",
    });
    expect(await issueInvoice(db, order.id)).toMatchObject({ id: invoice!.id });
    expect(
      await placeOrder(db, (await offerById(db, offer!.id))!, { userId: buyer.id, email: buyer.email }, form),
    ).toEqual({
      ok: false,
      reason: "closed",
    });
    expect((await ordersOfUser(db, buyer.id)).map((r) => r.order.id)).toContain(order.id);

    await afterOrderPaid(db, order.id, deps);
    const [toBuyer, toInbox] = mail.sent.slice(-2);
    expect(toBuyer!.subject).toBe(`Pasūtījums ${order.number} saņemts`);
    expect(toBuyer!.text).toContain(`${BASE}/konts/pasutijumi/${order.id}`);
    expect(toInbox!.to).toBe("info@trilio.test");
    expect(toInbox!.subject).toContain(order.number);
  });

  it("walks the order to delivered, then withdrawal and refund with a credit note", async () => {
    const [{ order }] = await ordersOfUser(db, buyer.id);
    expect(await moveOrder(db, order.id, { to: "delivered", by: "admin" })).toEqual({
      ok: false,
      reason: "not_allowed",
    });
    expect(await moveOrder(db, order.id, { to: "shipped", by: "admin", carrier: "omniva" })).toEqual({
      ok: false,
      reason: "tracking",
    });
    expect((await moveOrder(db, order.id, { to: "packed", by: "admin" })).ok).toBe(true);
    const shipped = await moveOrder(db, order.id, {
      to: "shipped",
      by: "admin",
      carrier: "omniva",
      trackingNumber: "CE123456789EE",
    });
    expect(shipped.ok && shipped.order.trackingUrl).toBe(
      "https://www.omniva.lv/sutijumu-izsekosana/?barcode=CE123456789EE",
    );
    const delivered = await moveOrder(db, order.id, { to: "delivered", by: "buyer" });
    expect(delivered.ok && delivered.order.deliveryConfirmedBy).toBe("buyer");
    expect(await correctDeliveredAt(db, order.id, new Date(Date.now() - DAY), "admin@test")).toBe(true);
    expect(await addOrderNote(db, order.id, "Piezvanīju", "admin@test")).toBe(true);
    expect(await addOrderNote(db, order.id, "  ", "admin@test")).toBe(false);

    expect((await moveOrder(db, order.id, { to: "return_requested", by: "buyer" })).ok).toBe(true);
    await afterWithdrawal(db, order.id, deps);
    expect(mail.sent.at(-2)!.subject).toContain("Atteikums");
    expect((await moveOrder(db, order.id, { to: "returned", by: "admin" })).ok).toBe(true);
    expect(await moveOrder(db, order.id, { to: "refunded", by: "admin" })).toEqual({
      ok: false,
      reason: "reference",
    });
    expect(
      (await moveOrder(db, order.id, { to: "refunded", by: "admin", refundReference: "PAYSERA-1" })).ok,
    ).toBe(true);
    const list = await invoicesOf(db, order.id);
    expect(list.map((i) => i.kind)).toEqual(["invoice", "credit_note"]);
    expect(list[1]).toMatchObject({ totalCents: -3900, creditForId: list[0]!.id });
    expect(await issueCreditNote(db, order.id)).toMatchObject({ id: list[1]!.id });
    const kinds = (await eventsOf(db, order.offerId)).map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "paid",
        "packed",
        "shipped",
        "delivered",
        "delivery_corrected",
        "note",
        "returned",
        "refunded",
      ]),
    );
  });

  it("composes every order e-mail with the right promises", async () => {
    const [{ order, offer }] = await ordersOfUser(db, buyer.id);
    const d = { baseUrl: BASE, signature: "Kristaps", inbox: "info@trilio.test" };
    const delivered = composeOrderEmail(
      "delivered",
      { ...order, deliveredAt: new Date("2026-10-10T12:00:00Z") },
      offer,
      d,
    );
    expect(delivered.text).toContain("vari atteikties no pirkuma bez iemesla");
    const company = composeOrderEmail("delivered", { ...order, buyerKind: "company" }, offer, d);
    expect(company.text).not.toContain("atteikties");
    expect(composeOrderEmail("shipped", order, offer, d).text).toContain("Omniva");
    expect(
      composeOrderEmail("shipped", { ...order, trackingUrl: null, carrier: "x" }, offer, d).text,
    ).not.toContain("Sekot");
    expect(composeOrderEmail("refunded", order, offer, d).text).toContain(formatEur(3900));
    expect(composeOrderEmail("return_requested", order, offer, d).subject).toContain(order.number);
    expect(composeOrderEmail("paid", order, offer, d).text).toContain("—");
    const fb = composeOrderEmail("feedback", order, offer, d);
    expect(fb.text).toContain(`/pasutijums/${order.feedbackToken}?atbilde=ok`);
    expect(fb.text).toContain("?atbilde=problema");
    // In English: English copy and formats, links to the /en pages.
    const en = composeOrderEmail("refunded", order, offer, d, { lang: "en" });
    expect(en.text).toContain(formatEur(3900, "en"));
    expect(en.subject).not.toBe(composeOrderEmail("refunded", order, offer, d).subject);
    expect(composeOrderEmail("paid", order, offer, d, { lang: "en" }).text).toContain(
      `${BASE}/en/konts/pasutijumi/${order.id}`,
    );
    expect(await userLang(db, null)).toBe("lv");
    expect(await userLang(db, buyer.id)).toBe("lv");
  });

  it("records one feedback answer and tells the inbox about a problem", async () => {
    const [{ order }] = await ordersOfUser(db, buyer.id);
    expect(await orderByFeedbackToken(db, "short")).toBeNull();
    const found = await orderByFeedbackToken(db, order.feedbackToken);
    expect(await recordFeedback(db, found!, "problem", " Skrāpējums uz vāka ")).toBe(true);
    expect(await recordFeedback(db, (await orderById(db, order.id))!, "ok", null)).toBe(false);
    expect((await orderById(db, order.id))?.feedbackNote).toBe("Skrāpējums uz vāka");
    await afterProblemReported(db, order.id, "Skrāpējums", deps);
    expect(mail.sent.at(-1)!.subject).toContain("problēma");
    await afterAcceptedWithoutPayments(db, order.id, deps);
    expect(mail.sent.at(-1)!.subject).toContain("maksājumi vēl nav ieslēgti");
    await afterOrderPaid(db, "00000000-0000-0000-0000-000000000000", deps);
  });

  it("VAT applies on invoices once Trilio is registered; company buyers get their details", async () => {
    const r = await createOffers(db, input({ productId: fridge, priceCents: 12100 }), "admin@test");
    const id = (r as { offerIds: string[] }).offerIds[0]!;
    await sendOffer(db, id, deps);
    const offer = (await offerById(db, id))!;
    const placed = await placeOrder(
      db,
      offer,
      { userId: buyer.id, email: buyer.email },
      {
        ...form,
        buyerKind: "company",
        companyName: "SIA Flow",
        companyRegNo: "40003000000",
        companyVatNo: "LV40003000000",
        legalAddress: "Rīga",
      },
    );
    const order = (placed as { order: { id: string } }).order;
    await db
      .update(offerOrders)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(offerOrders.id, order.id));
    const invoice = await issueInvoice(db, order.id, new Date(), {
      name: "Trilio SIA",
      regNo: "40000000001",
      vatNo: "LV40000000001",
      address: "Rīga",
      email: "info@trilio.test",
    });
    expect(invoice).toMatchObject({ vatRate: 21, netCents: 10000, vatCents: 2100, totalCents: 12100 });
    expect(invoice?.buyer).toMatchObject({
      kind: "company",
      name: "SIA Flow",
      vatNo: "LV40003000000",
      address: "Rīga",
    });
    expect(await orderOfOffer(db, id)).toMatchObject({ id: order.id });
  });

  it("the job expires, reminds once, asks for feedback and asks carriers", async () => {
    mail.sent.length = 0;
    const r = await createOffers(db, input({ validUntil: new Date(Date.now() + DAY) }), "admin@test");
    const remind = (r as { offerIds: string[] }).offerIds[0]!;
    await sendOffer(db, remind, deps);
    await db
      .update(specialOffers)
      .set({ sentAt: new Date(Date.now() - 3 * DAY) })
      .where(eq(specialOffers.id, remind));
    const r2 = await createOffers(db, input({ validUntil: new Date(Date.now() + 2 * DAY) }), "admin@test");
    const expire = (r2 as { offerIds: string[] }).offerIds[0]!;
    await sendOffer(db, expire, deps);
    const expiredOffer = (await offerById(db, expire))!;
    await placeOrder(db, expiredOffer, { userId: buyer.id, email: buyer.email }, form);
    await db
      .update(specialOffers)
      .set({ validUntil: new Date(Date.now() - 1000) })
      .where(eq(specialOffers.id, expire));

    // A shipped order the carrier reports as delivered, and one delivered a week ago.
    const r3 = await createOffers(db, input(), "admin@test");
    const shippedOffer = (r3 as { offerIds: string[] }).offerIds[0]!;
    await sendOffer(db, shippedOffer, deps);
    const p3 = await placeOrder(
      db,
      (await offerById(db, shippedOffer))!,
      { userId: buyer.id, email: buyer.email },
      form,
    );
    const shippedId = (p3 as { order: { id: string } }).order.id;
    await db
      .update(offerOrders)
      .set({
        status: "shipped",
        paidAt: new Date(),
        shippedAt: new Date(),
        carrier: "fake",
        trackingNumber: "F1",
      })
      .where(eq(offerOrders.id, shippedId));
    const r4 = await createOffers(db, input(), "admin@test");
    const doneOffer = (r4 as { offerIds: string[] }).offerIds[0]!;
    await sendOffer(db, doneOffer, deps);
    const p4 = await placeOrder(
      db,
      (await offerById(db, doneOffer))!,
      { userId: buyer.id, email: buyer.email },
      form,
    );
    const doneId = (p4 as { order: { id: string } }).order.id;
    await db
      .update(offerOrders)
      .set({ status: "delivered", paidAt: new Date(), deliveredAt: new Date(Date.now() - 8 * DAY) })
      .where(eq(offerOrders.id, doneId));

    const asked: string[] = [];
    const tracker: CarrierTracker = {
      carrier: "fake",
      perRun: 5,
      async track(n) {
        asked.push(n);
        return { delivered: true, at: new Date(Date.now() - 3600_000), lastEvent: "Izsniegts" };
      },
    };
    const first = await runOffersJob(db, { ...deps, trackers: [tracker] });
    expect(first).toMatchObject({ expired: 1, reminded: 1, feedbackAsked: 1, tracked: 1, delivered: 1 });
    expect(asked).toEqual(["F1"]);
    expect((await offerById(db, expire))?.status).toBe("expired");
    expect((await orderOfOffer(db, expire))?.status).toBe("cancelled");
    expect(await orderById(db, shippedId)).toMatchObject({
      status: "delivered",
      deliveryConfirmedBy: "carrier",
    });
    expect(mail.sent.map((m) => m.subject)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Atgādinājums/), expect.stringMatching(/viss kārtībā/)]),
    );
    const second = await runOffersJob(db, { ...deps, trackers: [tracker] });
    expect(second).toEqual({ expired: 0, reminded: 0, feedbackAsked: 0, tracked: 0, delivered: 0 });

    await setFlag(db, OFFERS_PAUSED, "1");
    expect(await sendReminder(db, (await offerById(db, remind))!, deps)).toBe(false);
    await setFlag(db, OFFERS_PAUSED, null);
    const failing = {
      ...deps,
      email: { send: async () => ({ ok: false as const, reason: "error" as const }) },
    };
    expect(await sendReminder(db, (await offerById(db, remind))!, failing)).toBe(false);
  });

  it("unsubscribing withdraws consent and cancels open offers", async () => {
    const r = await createOffers(db, input(), "admin@test");
    const open = (r as { offerIds: string[] }).offerIds[0]!;
    const token = await ensureOffersToken(db, buyer.id);
    expect(await ensureOffersToken(db, buyer.id)).toBe(token);
    expect(await unsubscribeByToken(db, "x")).toBe(false);
    expect(await unsubscribeByToken(db, "a".repeat(43))).toBe(false);
    expect(await unsubscribeByToken(db, token)).toBe(true);
    expect(await offersOptIn(db, buyer.id)).toBe(false);
    expect((await offerById(db, open))?.status).toBe("cancelled");
    expect(await sendReminder(db, (await offerById(db, open))!, deps)).toBe(false);
  });

  it("account deletion forgets what the courier needed and keeps invoices", async () => {
    const before = await db
      .select({ id: specialOffers.id })
      .from(specialOffers)
      .where(eq(specialOffers.userId, buyer.id));
    const r = await forgetBuyer(db, buyer.id);
    expect(r.offers).toBeGreaterThan(0);
    expect(r.orders).toBeGreaterThan(0);
    const after = await db
      .select({ id: specialOffers.id })
      .from(specialOffers)
      .where(eq(specialOffers.userId, buyer.id));
    expect(after.length).toBe(before.length - r.offers);
    const orders = await db.select().from(offerOrders).where(eq(offerOrders.userId, buyer.id));
    expect(orders.every((o) => o.phone === null && o.deliveryNote === null)).toBe(true);
    const anyInvoice = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        inArray(
          invoices.orderId,
          orders.map((o) => o.id),
        ),
      );
    expect(anyInvoice.length).toBeGreaterThan(0);
    await db.delete(savedItems).where(eq(savedItems.userId, buyer.id));
    await db.delete(appFlags).where(eq(appFlags.key, OFFERS_PAUSED));
  });
});
