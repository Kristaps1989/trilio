import { randomBytes } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { plans, products, savedItems, stores, subscriptions, users } from "@/db/schema";
import { saveProduct, setThreshold } from "@/db/queries/wishlist";
import { gtinCheckDigit } from "@/domain/catalog/ean";
import { memoryEmailSender } from "@/services/notify/email";
import { upsertOffers } from "@/services/ingestion/upsert";
import { wishlistTexts } from "@/services/texts";
import { runWishlistJob } from "./job";

// Integration: a saved product whose price fell below its baseline goes into
// the subscriber's digest, the baseline moves, a second run is debounced, and
// a user without the paid service gets nothing.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const EAN = "990000000888" + gtinCheckDigit("990000000888");

run("runWishlistJob", () => {
  let db: Db;
  let end: () => Promise<void>;
  let subscriber: string;
  let freeUser: string;
  let storeId: string;
  let productId: string;

  beforeAll(async () => {
    process.env.PAYMENT_TOKEN_KEY = randomBytes(32).toString("hex");
    const created = createDb(url);
    db = created.db;
    end = () => created.client.end();
    await db.delete(users).where(like(users.email, "wishlist-job-%"));
    await db.delete(products).where(eq(products.ean, EAN));
    await db.delete(stores).where(eq(stores.slug, "wishlist_job_store"));
    const [s] = await db
      .insert(stores)
      .values({ slug: "wishlist_job_store", displayName: "Wishlist Store", feedType: "sample" })
      .returning();
    storeId = s!.id;
    await upsertOffers(db, { id: storeId }, [
      {
        externalId: "wj-1",
        ean: EAN,
        brand: "WishBrand",
        modelCode: "WB-1",
        name: "WishBrand WB-1 tējkanna",
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
        url: "https://example.invalid/wj-1",
      },
    ]);
    const [p] = await db.select().from(products).where(eq(products.ean, EAN));
    productId = p!.id;
    const stamp = Date.now();
    const [u1] = await db
      .insert(users)
      .values({ email: `wishlist-job-a-${stamp}@example.invalid` })
      .returning();
    const [u2] = await db
      .insert(users)
      .values({ email: `wishlist-job-b-${stamp}@example.invalid` })
      .returning();
    subscriber = u1!.id;
    freeUser = u2!.id;
    await db
      .insert(plans)
      .values({ id: "wj-plan", name: "T", priceCents: 199, interval: "month" })
      .onConflictDoNothing();
    const periodEnd = new Date(Date.now() + 30 * 86_400_000);
    await db.insert(subscriptions).values({
      userId: subscriber,
      planId: "wj-plan",
      status: "active",
      provider: "mock",
      currentPeriodStart: new Date(),
      currentPeriodEnd: periodEnd,
      nextBillingAt: periodEnd,
    });
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, "wishlist-job-%"));
    await db.delete(products).where(eq(products.id, productId));
    await db.delete(stores).where(eq(stores.id, storeId));
    await end();
  });

  it("e-mails a digest for a drop, moves the baseline and debounces", async () => {
    for (const userId of [subscriber, freeUser]) {
      await saveProduct(db, userId, { productId, subcategoryId: "kettle", baselinePriceCents: 6000 });
    }
    await setThreshold(db, subscriber, "10");
    const email = memoryEmailSender();
    const res = await runWishlistJob(db, {
      email,
      baseUrl: "https://trilio.example",
      texts: wishlistTexts(),
    });
    expect(res.skippedNoAccess).toBeGreaterThanOrEqual(1);
    const mine = email.sent.filter((m) => m.to.startsWith("wishlist-job-"));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toContain("wishlist-job-a-");
    expect(mine[0]!.subject).toMatch(/^Cena kritusi: WishBrand WB-1 tējkanna tagad 50\s€$/);
    expect(mine[0]!.text).toMatch(/bija 60\s€/);
    expect(mine[0]!.text).toContain("https://trilio.example/velmju-saraksts");

    const [item] = await db.select().from(savedItems).where(eq(savedItems.userId, subscriber));
    expect(item!.baselinePriceCents).toBe(5000);
    expect(item!.lastNotifiedAt).not.toBeNull();

    const again = memoryEmailSender();
    await runWishlistJob(db, { email: again, baseUrl: "https://trilio.example", texts: wishlistTexts() });
    expect(again.sent.filter((m) => m.to.startsWith("wishlist-job-"))).toHaveLength(0);
  });

  it("skips a drop smaller than the user's threshold", async () => {
    await db
      .update(savedItems)
      .set({ baselinePriceCents: 5200, lastNotifiedAt: null })
      .where(eq(savedItems.userId, subscriber));
    const email = memoryEmailSender();
    await runWishlistJob(db, { email, baseUrl: "https://trilio.example", texts: wishlistTexts() });
    expect(email.sent.filter((m) => m.to.startsWith("wishlist-job-"))).toHaveLength(0);
  });
});
