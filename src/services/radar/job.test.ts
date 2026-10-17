import { randomBytes } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import {
  offers,
  plans,
  products,
  pushSubscriptions,
  radarEvents,
  radars,
  stores,
  subscriptions,
  users,
} from "@/db/schema";
import { gtinCheckDigit } from "@/domain/catalog/ean";
import { memoryEmailSender } from "@/services/notify/email";
import { memoryPushSender } from "@/services/notify/push";
import { upsertOffers } from "@/services/ingestion/upsert";
import { radarTexts } from "@/services/texts";
import { runRadarJob } from "./job";

// Integration: a radar whose baseline is above the current best price gets
// one email + one push, its baseline moves, and a second run is debounced.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const EAN = "990000000777" + gtinCheckDigit("990000000777");

run("runRadarJob", () => {
  let db: Db;
  let end: () => Promise<void>;
  let userId: string;
  let storeId: string;
  let productId: string;

  beforeAll(async () => {
    process.env.PAYMENT_TOKEN_KEY = randomBytes(32).toString("hex");
    const created = createDb(url);
    db = created.db;
    end = () => created.client.end();
    await db.delete(users).where(like(users.email, "radar-job-%"));
    await db.delete(products).where(eq(products.ean, EAN));
    await db.delete(stores).where(eq(stores.slug, "radar_job_store"));
    const [s] = await db
      .insert(stores)
      .values({ slug: "radar_job_store", displayName: "Radar Job Store", feedType: "sample" })
      .returning();
    storeId = s!.id;
    await upsertOffers(db, { id: storeId }, [
      {
        externalId: "rj-1",
        ean: EAN,
        brand: "RadarBrand",
        modelCode: "RB-1",
        name: "RadarBrand RB-1",
        description: null,
        subcategoryId: "kettle",
        attributes: {},
        tags: [],
        specs: null,
        kwhYear: null,
        rating: 80,
        imageUrl: null,
        condition: "new",
        grade: null,
        warrantyMonths: null,
        priceCents: 5000,
        stock: "in",
        deliveryEtaDays: null,
        url: "https://example.invalid/rj-1",
      },
    ]);
    const [p] = await db.select().from(products).where(eq(products.ean, EAN));
    productId = p!.id;
    const [u] = await db
      .insert(users)
      .values({ email: `radar-job-${Date.now()}@example.invalid` })
      .returning();
    userId = u!.id;
    await db
      .insert(plans)
      .values({ id: "rj-plan", name: "T", priceCents: 199, interval: "month" })
      .onConflictDoNothing();
    const end1 = new Date(Date.now() + 30 * 86_400_000);
    await db.insert(subscriptions).values({
      userId,
      planId: "rj-plan",
      status: "active",
      provider: "mock",
      currentPeriodStart: new Date(),
      currentPeriodEnd: end1,
      nextBillingAt: end1,
    });
    await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint: "https://push.example.invalid/rj", p256dh: "k", auth: "a" });
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(products).where(eq(products.id, productId));
    await db.delete(stores).where(eq(stores.id, storeId));
    await end();
  });

  it("notifies a drop through both channels, moves the baseline, and debounces", async () => {
    const [r] = await db
      .insert(radars)
      .values({
        userId,
        productId,
        threshold: "5",
        scope: "only",
        channels: ["email", "push"],
        baselinePriceCents: 6000,
      })
      .returning();
    const email = memoryEmailSender();
    const push = memoryPushSender();
    const res = await runRadarJob(db, { email, push, baseUrl: "https://t.invalid", texts: radarTexts() });
    expect(res).toMatchObject({ evaluated: 1, notified: 1, skippedNoAccess: 0 });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.subject).toContain("RadarBrand RB-1");
    expect(email.sent[0]!.text).toContain("50\u00A0€");
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.payload.url).toBe("https://t.invalid/radars");
    const [after] = await db.select().from(radars).where(eq(radars.id, r!.id));
    expect(after!.baselinePriceCents).toBe(5000);
    expect(after!.lastNotifiedAt).not.toBeNull();
    const events = await db.select().from(radarEvents).where(eq(radarEvents.radarId, r!.id));
    expect(events).toHaveLength(1);
    expect(events[0]!.channels.sort()).toEqual(["email", "push"]);

    // Same prices, same day → nothing more
    const again = await runRadarJob(db, { email, push, baseUrl: "https://t.invalid", texts: radarTexts() });
    expect(again.notified).toBe(0);
    expect(email.sent).toHaveLength(1);
  });

  it("skips radars of users without access and sets a baseline when missing", async () => {
    await db.update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.userId, userId));
    const [r] = await db
      .insert(radars)
      .values({ userId, productId, threshold: "any", channels: ["email"], baselinePriceCents: null })
      .returning();
    const email = memoryEmailSender();
    const res = await runRadarJob(db, {
      email,
      push: memoryPushSender(),
      baseUrl: "https://t.invalid",
      texts: radarTexts(),
    });
    expect(res.skippedNoAccess).toBeGreaterThanOrEqual(1);
    expect(email.sent).toHaveLength(0);
    await db.update(subscriptions).set({ status: "active" }).where(eq(subscriptions.userId, userId));
    await runRadarJob(db, {
      email,
      push: memoryPushSender(),
      baseUrl: "https://t.invalid",
      texts: radarTexts(),
    });
    const [after] = await db.select().from(radars).where(eq(radars.id, r!.id));
    expect(after!.baselinePriceCents).toBe(5000);
  });

  it("purges radars soft-deleted more than a day ago", async () => {
    const [r] = await db
      .insert(radars)
      .values({ userId, productId, deletedAt: new Date(Date.now() - 2 * 86_400_000) })
      .returning();
    const res = await runRadarJob(db, {
      email: memoryEmailSender(),
      push: memoryPushSender(),
      baseUrl: "https://t.invalid",
      texts: radarTexts(),
    });
    expect(res.purged).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(radars).where(eq(radars.id, r!.id))).toHaveLength(0);
    expect(await db.select().from(offers).where(eq(offers.productId, productId))).toHaveLength(1);
  });
});
