import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import {
  notifyRequests,
  offerEvents,
  offerOrders,
  products,
  specialOffers,
  stores,
  users,
} from "@/db/schema";
import { gtinCheckDigit } from "@/domain/catalog/ean";
import type { OrderForm } from "@/domain/offers/checkout";
import { leadItems, requestsOf } from "@/services/admin/crm";
import { upsertOffers } from "@/services/ingestion/upsert";
import { memoryEmailSender } from "@/services/notify/email";
import { confirmNotify } from "@/services/notify/requests";
import type { MailDeps } from "./emails";
import { sendReminder } from "./emails";
import { createOffers, offerById, offerSignIn, previewOffer, sendOffer, type OfferInput } from "./offers";
import { placeOrder } from "./orders";

// One proposal to an "Iegūt lētāk" request whose address is not confirmed
// (docs/REQUEST_OFFER_PLAN.md): only for requests whose text promised it, once,
// without an unsubscribe, no reminder; the link or the confirmation gives it an account.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const EAN = "990000000881" + gtinCheckDigit("990000000881");
const OTHER_EAN = "990000000882" + gtinCheckDigit("990000000882");
const DAY = 24 * 3600 * 1000;
const BASE = "https://trilio.test";
const PREFIX = "request-offers-";

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
  deliveryNote: null,
  companyName: null,
  companyRegNo: null,
  companyVatNo: null,
  legalAddress: null,
};

run("proposals to unconfirmed requests", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  let product: string;
  let other: string;
  const mail = memoryEmailSender();
  const deps: MailDeps = { email: mail, baseUrl: BASE, signature: "Kristaps", inbox: "info@trilio.test" };
  const stamp = Date.now();
  const address = (n: string) => `${PREFIX}${n}-${stamp}@example.invalid`;
  const input = (requestIds: string[], productId = product): OfferInput => ({
    productId,
    userIds: [],
    requestIds,
    priceCents: 3900,
    condition: "new",
    grade: null,
    warrantyMonths: 24,
    quantity: 1,
    deliveryWorkingDays: 3,
    validUntil: new Date(Date.now() + 7 * DAY),
    message: null,
    supplierNote: null,
    costCents: null,
  });
  const request = async (n: string, over: Partial<typeof notifyRequests.$inferInsert> = {}) => {
    const [row] = await db
      .insert(notifyRequests)
      .values({
        token: `${PREFIX}${n}-${stamp}-token-abcdefghij`,
        email: address(n),
        kind: "product",
        productId: product,
        subcategoryId: "kettle",
        label: "FlowBrand kettle",
        locale: "lv",
        consent: "notify.body@2026-11-09",
        offers: true,
        ...over,
      })
      .returning();
    return row!;
  };

  async function cleanup() {
    const reqs = await db
      .select({ id: notifyRequests.id })
      .from(notifyRequests)
      .where(like(notifyRequests.email, `${PREFIX}%`));
    const people = await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${PREFIX}%`));
    const offers = await db
      .select({ id: specialOffers.id })
      .from(specialOffers)
      .where(like(specialOffers.productName, "RequestBrand%"));
    const offerIds = offers.map((o) => o.id);
    if (offerIds.length) {
      await db.delete(offerEvents).where(inArray(offerEvents.offerId, offerIds));
      await db.delete(offerOrders).where(inArray(offerOrders.offerId, offerIds));
      await db.delete(specialOffers).where(inArray(specialOffers.id, offerIds));
    }
    if (reqs.length)
      await db.delete(notifyRequests).where(
        inArray(
          notifyRequests.id,
          reqs.map((r) => r.id),
        ),
      );
    if (people.length)
      await db.delete(users).where(
        inArray(
          users.id,
          people.map((p) => p.id),
        ),
      );
    await db.delete(products).where(inArray(products.ean, [EAN, OTHER_EAN]));
    await db.delete(stores).where(eq(stores.slug, "request_offers_store"));
  }

  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    await cleanup();
    const [s] = await db
      .insert(stores)
      .values({ slug: "request_offers_store", displayName: "Request Store", feedType: "sample" })
      .returning();
    const row = (ean: string) => ({
      externalId: `ro-${ean}`,
      ean,
      brand: "RequestBrand",
      modelCode: `RB-${ean.slice(-3)}`,
      name: `RequestBrand kettle ${ean.slice(-3)}`,
      description: null,
      subcategoryId: "kettle",
      attributes: {},
      tags: [],
      specs: null,
      kwhYear: null,
      rating: 80,
      imageUrl: null,
      condition: "new" as const,
      grade: null,
      warrantyMonths: null,
      priceCents: 4500,
      stock: "in" as const,
      deliveryEtaDays: null,
      url: `https://example.invalid/${ean}`,
    });
    await upsertOffers(db, { id: s!.id }, [row(EAN), row(OTHER_EAN)]);
    const list = await db
      .select()
      .from(products)
      .where(inArray(products.ean, [EAN, OTHER_EAN]));
    product = list.find((p) => p.ean === EAN)!.id;
    other = list.find((p) => p.ean === OTHER_EAN)!.id;
  });

  afterAll(async () => {
    await cleanup();
    await end();
  });

  it("drafts one proposal per request whose text promised it, and says why not for the rest", async () => {
    const fresh = await request("fresh");
    const old = await request("old", { consent: "notify.body@2026-10-31" });
    const plain = await request("plain", { consent: "notify.bodyPlain@2026-11-09", offers: false });
    const gone = await request("gone", { createdAt: new Date(Date.now() - 8 * DAY) });
    const made = await createOffers(db, input([fresh.id, old.id, plain.id, gone.id]), "admin@test");
    expect(made.ok && made.offerIds).toHaveLength(1);
    expect(made.ok && made.skipped.map((s) => s.reason).sort()).toEqual(["expired", "no_offers", "old_text"]);
    const offer = await offerById(db, made.ok ? made.offerIds[0]! : "");
    expect(offer).toMatchObject({ userId: null, email: fresh.email, notifyRequestId: fresh.id });
    // Once per request, and only for the product asked about.
    const again = await createOffers(db, input([fresh.id]), "admin@test");
    expect(again.ok && again.skipped).toEqual([{ userId: fresh.id, reason: "offered" }]);
    const elsewhere = await createOffers(db, input([old.id], other), "admin@test");
    expect(elsewhere.ok && elsewhere.skipped[0]!.reason).toBe("old_text");

    // The admin sees them as demand, each with its reason.
    const listed = await requestsOf(db, product);
    const reasons = new Map(listed.map((r) => [r.email, r.reason]));
    expect(reasons.get(fresh.email)).toBe("offered");
    expect(reasons.get(old.email)).toBe("old_text");
    expect(reasons.has(gone.email)).toBe(false);
    const lead = (await leadItems(db)).find((i) => i.id === product)!;
    expect(lead.savers).toMatchObject({ total: 0, requested: 3 });
  });

  it("sends it once to the address, saying why, with a link to follow the price and no unsubscribe", async () => {
    const [offer] = await db
      .select()
      .from(specialOffers)
      .where(eq(specialOffers.email, address("fresh")));
    const preview = await previewOffer(db, offer!.id, deps);
    expect(preview!.to).toBe(address("fresh"));
    const sent = await sendOffer(db, offer!.id, deps);
    expect(sent).toEqual({ ok: true, emailed: true });
    const message = mail.sent.find((m) => m.to === address("fresh"))!;
    expect(message.text).toContain("pieprasīji zemāku cenu šai precei");
    expect(message.text).toContain("vairāk nerakstīsim");
    expect(message.text).toContain(`/pazinot/${PREFIX}fresh-${stamp}-token-abcdefghij`);
    expect(message.headers?.["List-Unsubscribe"]).toBeUndefined();
    expect(message.html).not.toContain("Atteikties no piedāvājumiem");
    // No reminder: nothing else goes to an unconfirmed address.
    expect(await sendReminder(db, (await offerById(db, offer!.id))!, deps)).toBe(false);
  });

  it("its link proves the address: the account is made, the offer is theirs, and only theirs to order", async () => {
    const [offer] = await db
      .select()
      .from(specialOffers)
      .where(eq(specialOffers.email, address("fresh")));
    const signed = await offerSignIn(db, offer!.token);
    expect(signed?.email).toBe(address("fresh"));
    const owned = (await offerById(db, offer!.id))!;
    expect(owned.userId).toBe(signed!.id);
    const [account] = await db.select().from(users).where(eq(users.id, signed!.id));
    // Proven address, but Trilio's other offers stay off until the person says yes.
    expect(account!.emailVerified).not.toBeNull();
    expect(account!.offersOptIn).toBe(false);
    const [stranger] = await db
      .insert(users)
      .values({ email: address("stranger") })
      .returning();
    expect(await placeOrder(db, owned, { userId: stranger!.id, email: stranger!.email }, form)).toEqual({
      ok: false,
      reason: "not_yours",
    });
    const placed = await placeOrder(db, owned, { userId: signed!.id, email: signed!.email }, form);
    expect(placed.ok).toBe(true);
  });

  it("confirming the request later hands its proposal to the new account", async () => {
    const later = await request("later");
    const made = await createOffers(db, input([later.id]), "admin@test");
    const id = made.ok ? made.offerIds[0]! : "";
    const confirmed = await confirmNotify(db, later.token, async () => true);
    expect(confirmed.ok).toBe(true);
    const offer = (await offerById(db, id))!;
    expect(offer.userId).toBe(confirmed.ok ? confirmed.userId : "");
  });
});
