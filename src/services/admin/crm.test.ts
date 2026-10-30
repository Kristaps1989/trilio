import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { offerEvents, offerOrders, products, savedItems, specialOffers, stores, users } from "@/db/schema";
import { gtinCheckDigit } from "@/domain/catalog/ean";
import { applyFilters, parseFilters } from "@/domain/admin/crm";
import { upsertOffers } from "@/services/ingestion/upsert";
import {
  addLeadNote,
  addPartnerRequest,
  confirmedCost,
  leadItems,
  leadRecord,
  orderItems,
  partnerHistory,
  partnerNames,
  workItems,
} from "./crm";

// The CRM service against Postgres (docs/CRM_PLAN.md): leads from saves, the
// partner mark with its order number on a lead and on one order, notes, and
// the filters finding a record by EAN or by the partner's order number.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const EAN = "990000000901";
const FULL_EAN = EAN + gtinCheckDigit(EAN);

run("CRM service", () => {
  let db: Db;
  let end: () => Promise<void>;
  let productId: string;
  let orderId: string;
  const stamp = Date.now();

  async function cleanup() {
    await db.delete(users).where(like(users.email, "crm-test-%"));
    await db.delete(products).where(eq(products.ean, FULL_EAN));
    await db.delete(stores).where(eq(stores.slug, "crm_test_store"));
  }

  beforeAll(async () => {
    const created = createDb(url);
    db = created.db;
    end = () => created.client.end();
    await cleanup();
    const [s] = await db
      .insert(stores)
      .values({ slug: "crm_test_store", displayName: "CRM Store", feedType: "sample" })
      .returning();
    await upsertOffers(db, { id: s!.id }, [
      {
        externalId: "crm-1",
        ean: FULL_EAN,
        brand: "Bosch",
        modelCode: "KGN36CRM",
        name: "Bosch KGN36CRM ledusskapis",
        description: null,
        subcategoryId: "fridge",
        attributes: {},
        tags: [],
        specs: null,
        kwhYear: null,
        rating: null,
        imageUrl: null,
        condition: "new",
        grade: null,
        warrantyMonths: null,
        priceCents: 71999,
        stock: "in",
        deliveryEtaDays: null,
        url: "https://crm-store.test/p",
      },
    ]);
    const [p] = await db.select().from(products).where(eq(products.ean, FULL_EAN));
    productId = p!.id;
    const [a] = await db
      .insert(users)
      .values({ email: `crm-test-a-${stamp}@example.invalid`, offersOptIn: true })
      .returning();
    const [b] = await db
      .insert(users)
      .values({ email: `crm-test-b-${stamp}@example.invalid` })
      .returning();
    for (const u of [a!, b!])
      await db.insert(savedItems).values({
        userId: u.id,
        kind: "product",
        key: `p:${productId}`,
        productId,
        subcategoryId: "fridge",
        baselinePriceCents: 71999,
      });
    const [offer] = await db
      .insert(specialOffers)
      .values({
        token: `crm-${stamp}-token-00000000000000000000`,
        userId: a!.id,
        productId,
        productName: p!.name,
        subcategoryId: "fridge",
        priceCents: 67000,
        deliveryWorkingDays: 5,
        validUntil: new Date(Date.now() + 7 * 86_400_000),
        createdBy: "admin@test",
        status: "paid",
      })
      .returning();
    const [order] = await db
      .insert(offerOrders)
      .values({
        offerId: offer!.id,
        userId: a!.id,
        number: `CRM-${stamp}`,
        status: "paid",
        amountCents: 67000,
        buyerKind: "person",
        fullName: "Anna Bērziņa",
        phone: "+371 20000000",
        email: a!.email,
        street: "Brīvības 1",
        city: "Rīga",
        postcode: "LV-1050",
        deliveryMethod: "courier",
        termsAcceptedAt: new Date(),
        paidAt: new Date(),
        feedbackToken: `crm-fb-${stamp}`,
      })
      .returning();
    orderId = order!.id;
  });

  afterAll(async () => {
    await cleanup();
    await end();
  });

  it("a saved product is a lead with codes; bought, it is done", async () => {
    const lead = (await leadItems(db)).find((i) => i.id === productId)!;
    expect(lead).toMatchObject({
      kind: "lead",
      product: { modelCode: "KGN36CRM", ean: FULL_EAN, subcategoryId: "fridge" },
      savers: { total: 2, optedIn: 1, offered: 1, bought: 1 },
      stage: "won",
      state: "done",
    });
  });

  it("a paid order is Trilio's to pack; ordered from the partner it waits for the partner, with the order number", async () => {
    let order = (await orderItems(db, new Date())).find((i) => i.id === orderId)!;
    expect(order).toMatchObject({
      state: "action",
      next: "pack",
      number: `CRM-${stamp}`,
      person: "Anna Bērziņa",
    });
    const row = await addPartnerRequest(
      db,
      {
        productId,
        orderId,
        status: "requested",
        partner: " Euronics ",
        ref: "48213",
        costCents: null,
        note: "zvanīju",
      },
      "admin@test",
    );
    expect(row).toMatchObject({ partner: "Euronics", partnerOrderRef: "48213" });
    order = (await orderItems(db, new Date())).find((i) => i.id === orderId)!;
    expect(order).toMatchObject({ state: "partner", partner: { status: "requested", ref: "48213" } });
    // The order's timeline says so, and the lead's own mark stays separate.
    const events = await db.select().from(offerEvents).where(eq(offerEvents.orderId, orderId));
    expect(events.map((e) => e.kind)).toContain("partner_requested");
    expect(await partnerHistory(db, productId)).toHaveLength(0);
    expect(await partnerHistory(db, productId, orderId)).toHaveLength(1);
    // Found by the partner's order number and by EAN.
    const items = await workItems(db);
    expect(applyFilters(items, parseFilters({ q: "48213" }), new Date()).rows.map((i) => i.id)).toContain(
      orderId,
    );
    expect(
      applyFilters(items, parseFilters({ q: FULL_EAN, kind: "lead" }), new Date()).rows.map((i) => i.id),
    ).toEqual([productId]);
    expect(applyFilters(items, parseFilters({ partner: "requested", q: "KGN36CRM" }), new Date()).total).toBe(
      1,
    );
  });

  it("a partner's confirmed cost pre-fills offers; names become suggestions", async () => {
    await addPartnerRequest(
      db,
      {
        productId,
        orderId: null,
        status: "confirmed",
        partner: "Euronics",
        ref: "48214",
        costCents: 60000,
        note: null,
      },
      "admin@test",
    );
    expect(await confirmedCost(db, productId)).toBe(60000);
    expect(await partnerNames(db)).toContain("Euronics");
    expect(
      await addPartnerRequest(
        db,
        {
          productId: "00000000-0000-0000-0000-000000000000",
          orderId: null,
          status: "requested",
          partner: null,
          ref: null,
          costCents: null,
          note: null,
        },
        "admin@test",
      ),
    ).toBeNull();
  });

  it("notes and the lead record", async () => {
    expect(await addLeadNote(db, productId, "  ", "admin@test")).toBe(false);
    expect(await addLeadNote(db, productId, "Partneris atbildēs pirmdien", "admin@test")).toBe(true);
    const r = (await leadRecord(db, productId))!;
    expect(r.savers).toHaveLength(2);
    expect(r.offers).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ note: "Partneris atbildēs pirmdien", createdBy: "admin@test" });
    expect(r.history[0]).toMatchObject({ status: "confirmed", costCents: 60000 });
    expect(r.prices).toMatchObject({ bestCents: 71999, bestStore: "CRM Store" });
    expect(await leadRecord(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
