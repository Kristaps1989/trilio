import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import {
  adminAudit,
  affiliateClicks,
  eprelLookups,
  invoices,
  offerEvents,
  offerOrders,
  offers,
  products,
  savedItems,
  searchSessions,
  specialOffers,
  stores,
  users,
  visitDaily,
  visitSalts,
  visits,
} from "@/db/schema";
import { saveProduct } from "@/db/queries/wishlist";
import { gtinCheckDigit } from "@/domain/catalog/ean";
import { rigaDay } from "@/domain/analytics/visits";
import { upsertOffers } from "@/services/ingestion/upsert";
import { recordVisit, rollupVisits, visitRows } from "@/services/visits/visits";
import { audit, getFlag, offersPaused, recentAudit, setFlag, OFFERS_PAUSED } from "./audit";
import {
  demand,
  eprelCounts,
  headline,
  lastRuns,
  listOffers,
  listOrders,
  listUsers,
  ordersNeedingDelivery,
  retryEprelErrors,
  saversOf,
  searchStats,
  shopStats,
  todayTodo,
  userDetail,
  visitStats,
} from "./stats";

// Integration: the admin's read side over real rows (docs/ADMIN_AND_OFFERS_PLAN.md §4),
// plus first-party visit counting and the audit trail.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const EAN = "990000000555" + gtinCheckDigit("990000000555");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const DAY = 24 * 3600 * 1000;

run("admin statistics, visits and audit", () => {
  let db: Db;
  let end: () => Promise<void>;
  let productId: string;
  let storeId: string;
  let userA: string;
  let userB: string;
  const stamp = Date.now();
  const marker = `/kategorija/admin-test-${stamp}`;

  async function cleanup() {
    const old = await db.select({ id: users.id }).from(users).where(like(users.email, "admin-stats-%"));
    const ids = old.map((u) => u.id);
    if (ids.length) {
      const o = await db
        .select({ id: specialOffers.id })
        .from(specialOffers)
        .where(inArray(specialOffers.userId, ids));
      const oids = o.map((x) => x.id);
      if (oids.length) {
        const orders = await db
          .select({ id: offerOrders.id })
          .from(offerOrders)
          .where(inArray(offerOrders.offerId, oids));
        if (orders.length) {
          await db.delete(invoices).where(
            inArray(
              invoices.orderId,
              orders.map((x) => x.id),
            ),
          );
          await db.delete(offerEvents).where(inArray(offerEvents.offerId, oids));
          await db.delete(offerOrders).where(
            inArray(
              offerOrders.id,
              orders.map((x) => x.id),
            ),
          );
        }
        await db.delete(specialOffers).where(inArray(specialOffers.id, oids));
      }
      await db.delete(users).where(inArray(users.id, ids));
    }
    await db.delete(products).where(eq(products.ean, EAN));
    await db.delete(stores).where(eq(stores.slug, "admin_stats_store"));
    await db.delete(visits).where(like(visits.path, "/kategorija/admin-test-%"));
    await db.delete(visitDaily).where(like(visitDaily.path, "/kategorija/admin-test-%"));
    await db.delete(adminAudit).where(eq(adminAudit.adminEmail, "admin-stats@test"));
  }

  beforeAll(async () => {
    const created = createDb(url);
    db = created.db;
    end = () => created.client.end();
    await cleanup();
    const [s] = await db
      .insert(stores)
      .values({ slug: "admin_stats_store", displayName: "Admin Stats Store", feedType: "sample" })
      .returning();
    storeId = s!.id;
    await upsertOffers(db, { id: storeId }, [
      {
        externalId: "as-1",
        ean: EAN,
        brand: "StatBrand",
        modelCode: "SB-1",
        name: "StatBrand blenderis",
        description: null,
        subcategoryId: "blender",
        attributes: {},
        tags: [],
        specs: null,
        kwhYear: null,
        rating: 70,
        imageUrl: null,
        condition: "new",
        grade: null,
        warrantyMonths: null,
        priceCents: 8900,
        stock: "in",
        deliveryEtaDays: null,
        url: "https://example.invalid/as-1",
      },
    ]);
    const [p] = await db.select().from(products).where(eq(products.ean, EAN));
    productId = p!.id;
    const [a] = await db
      .insert(users)
      .values({ email: `admin-stats-a-${stamp}@example.invalid`, offersOptIn: true, adminNote: "VIP" })
      .returning();
    const [b] = await db
      .insert(users)
      .values({ email: `admin-stats-b-${stamp}@example.invalid` })
      .returning();
    userA = a!.id;
    userB = b!.id;
    await saveProduct(db, userA, { productId, subcategoryId: "blender", baselinePriceCents: 9900 });
    await saveProduct(db, userB, { productId, subcategoryId: "blender", baselinePriceCents: 9900 });
    await db.insert(savedItems).values({
      userId: userA,
      kind: "search",
      key: `s:blender:${stamp}`,
      subcategoryId: "blender",
      answersParam: "x",
      label: "Blenderi",
    });
    await db.insert(searchSessions).values([
      { subcategoryId: "blender", answers: { power: "high", use: ["smoothie", "ice"] }, budgetCents: 10000 },
      { subcategoryId: "blender", answers: { power: "high" }, budgetCents: 20000 },
    ]);
    const [offerRow] = await db.select({ id: offers.id }).from(offers).where(eq(offers.storeId, storeId));
    await db.insert(affiliateClicks).values({ offerId: offerRow!.id });
  });

  afterAll(async () => {
    await setFlag(db, OFFERS_PAUSED, null);
    await cleanup();
    await end();
  });

  it("counts visits without cookies, rolls them up and purges old rows", async () => {
    const now = new Date();
    expect(await recordVisit(db, { path: marker, ip: "10.0.0.1", userAgent: UA, now })).toBe(true);
    expect(await recordVisit(db, { path: marker, ip: "10.0.0.1", userAgent: UA, now })).toBe(true);
    expect(await recordVisit(db, { path: marker, ip: "10.0.0.2", userAgent: UA, now })).toBe(true);
    expect(await recordVisit(db, { path: marker, ip: "10.0.0.3", userAgent: "curl/8" })).toBe(false);
    expect(await recordVisit(db, { path: "/admin", ip: "10.0.0.3", userAgent: UA })).toBe(false);
    const today = rigaDay(now);
    const live = (await visitRows(db, today, today, now)).find((r) => r.path === marker);
    expect(live).toMatchObject({ views: 3, visitors: 2, section: "landing" });

    // Yesterday's rows go into visit_daily; a 40-day-old row is purged.
    const yesterday = rigaDay(new Date(now.getTime() - DAY));
    await db.insert(visits).values([
      { day: yesterday, path: marker, section: "landing", visitorHash: "h1" },
      { day: yesterday, path: marker, section: "landing", visitorHash: "h1" },
      {
        day: rigaDay(new Date(now.getTime() - 40 * DAY)),
        path: marker,
        section: "landing",
        visitorHash: "old",
      },
    ]);
    const rolled = await rollupVisits(db, now);
    expect(rolled.purged).toBeGreaterThanOrEqual(1);
    expect(rolled.days).toBeGreaterThanOrEqual(1);
    const [daily] = await db
      .select()
      .from(visitDaily)
      .where(and(eq(visitDaily.path, marker), eq(visitDaily.day, yesterday)));
    expect(daily).toMatchObject({ views: 2, visitors: 1 });
    await rollupVisits(db, now);
    const both = (await visitRows(db, yesterday, today, now)).filter((r) => r.path === marker);
    expect(both.map((r) => r.views).sort()).toEqual([2, 3]);
    const salts = await db.select().from(visitSalts);
    expect(salts.every((s) => s.day >= yesterday)).toBe(true);

    const stats = await visitStats(db, yesterday, today, now);
    expect(stats.paths.find((p) => p.key === marker)).toMatchObject({ views: 5, visitors: 3 });
    expect(stats.days.map((d) => d.day)).toEqual([yesterday, today]);
    expect(stats.sections.find((s) => s.key === "landing")!.views).toBeGreaterThanOrEqual(5);
  });

  it("summarises searches with budgets and answers, and clicks per shop", async () => {
    const today = rigaDay(new Date());
    const s = await searchStats(db, today, today);
    const blender = s.subcategories.find((x) => x.subcategoryId === "blender")!;
    expect(blender.searches).toBeGreaterThanOrEqual(2);
    expect(blender.budget).not.toBeNull();
    expect(blender.answers[0]).toMatchObject({
      question: "power",
      options: [expect.objectContaining({ option: "high" })],
    });
    expect(s.days).toHaveLength(1);
    const shops = await shopStats(db, today, today);
    expect(shops.find((x) => x.store === "Admin Stats Store")).toEqual({
      store: "Admin Stats Store",
      clicks: 1,
    });
  });

  it("lists users with what they saved and their consent", async () => {
    const rows = await listUsers(db, `admin-stats-a-${stamp}`);
    expect(rows).toEqual([
      expect.objectContaining({
        id: userA,
        offersOptIn: true,
        savedProducts: 1,
        savedSearches: 1,
        subscribed: false,
        offersSent: 0,
      }),
    ]);
    expect((await listUsers(db)).length).toBeGreaterThan(0);
    const detail = await userDetail(db, userA);
    expect(detail?.user.adminNote).toBe("VIP");
    expect(detail?.savedProducts[0]).toMatchObject({
      product: { id: productId },
      best: { priceCents: 8900 },
    });
    expect(detail?.savedSearches).toHaveLength(1);
    expect(await userDetail(db, "nope")).toBeNull();
    expect(await userDetail(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("ranks demand by savers with consent counts and prices", async () => {
    const rows = await demand(db, { subcategoryId: "blender", minSavers: 2 });
    expect(rows.find((r) => r.productId === productId)).toMatchObject({
      savers: 2,
      optedIn: 1,
      bestCents: 8900,
      bestStore: "Admin Stats Store",
      low30Cents: 8900,
    });
    expect(await demand(db, { subcategoryId: "blender", minSavers: 50 })).toEqual([]);
    const savers = await saversOf(db, productId);
    expect(savers.map((s) => s.optIn).sort()).toEqual([false, true]);
  });

  it("puts what needs a hand on Šodien, and the month's numbers", async () => {
    const [offer] = await db
      .insert(specialOffers)
      .values({
        token: `admin-stats-${stamp}-token-aaaaaaaaaaaaaaaa`,
        userId: userA,
        productId,
        productName: "StatBrand blenderis",
        subcategoryId: "blender",
        priceCents: 7900,
        costCents: 6000,
        validUntil: new Date(Date.now() + 3600_000),
        status: "sent",
        sentAt: new Date(),
        createdBy: "admin-stats@test",
      })
      .returning();
    const base = {
      offerId: offer!.id,
      userId: userA,
      amountCents: 7900,
      fullName: "Anna",
      email: "a@example.invalid",
    };
    const [paid] = await db
      .insert(offerOrders)
      .values({
        ...base,
        number: `T-AS${String(stamp).slice(-4)}`,
        status: "paid",
        paidAt: new Date(),
        feedbackToken: `fb-${stamp}-aaaaaaaaaaaaaaaaaaaa`,
      })
      .returning();
    const todo = await todayTodo(db);
    const kinds = todo.filter((t) => t.id.startsWith(paid!.id) || t.id === offer!.id).map((t) => t.kind);
    expect(kinds.sort()).toEqual(["expiring", "ship"]);

    await db
      .update(offerOrders)
      .set({
        status: "shipped",
        shippedAt: new Date(Date.now() - 12 * DAY),
        feedback: "problem",
        feedbackNote: "Bojāts",
      })
      .where(eq(offerOrders.id, paid!.id));
    const later = (await todayTodo(db)).filter((t) => t.id.startsWith(paid!.id)).map((t) => t.kind);
    expect(later.sort()).toEqual(["late", "problem"]);
    expect((await ordersNeedingDelivery(db)).some((r) => r.order.id === paid!.id)).toBe(true);
    await db
      .insert(offerEvents)
      .values({ offerId: offer!.id, orderId: paid!.id, kind: "problem_resolved", source: "admin" });
    await db.update(offerOrders).set({ status: "return_requested" }).where(eq(offerOrders.id, paid!.id));
    expect((await todayTodo(db)).filter((t) => t.id.startsWith(paid!.id)).map((t) => t.kind)).toEqual([
      "return",
    ]);
    await db.update(offerOrders).set({ status: "awaiting_payment" }).where(eq(offerOrders.id, paid!.id));
    expect((await todayTodo(db)).filter((t) => t.id.startsWith(paid!.id)).map((t) => t.kind)).toEqual([
      "unpaid",
    ]);
    await db.update(offerOrders).set({ status: "delivered" }).where(eq(offerOrders.id, paid!.id));

    const h = await headline(db);
    expect(h.offersSentMonth).toBeGreaterThanOrEqual(1);
    expect(h.offersPaidMonth).toBeGreaterThanOrEqual(1);
    expect(h.revenueMonthCents).toBeGreaterThanOrEqual(7900);
    expect(h.paidRatio).not.toBeNull();

    expect((await listOffers(db, "sent")).some((r) => r.offer.id === offer!.id)).toBe(true);
    expect((await listOffers(db, "bogus")).length).toBeGreaterThan(0);
    expect((await listOrders(db, "delivered")).some((r) => r.order.id === paid!.id)).toBe(true);
    expect((await listOrders(db)).length).toBeGreaterThan(0);
    expect((await listUsers(db, `admin-stats-a-${stamp}`))[0]).toMatchObject({
      offersSent: 1,
      ordersPaid: 1,
    });
  });

  it("shows shops' last runs and EPREL counts; failed lookups can be retried", async () => {
    const runs = await lastRuns(db);
    expect(runs.some((r) => r.storeName === "Admin Stats Store")).toBe(true);
    await db.insert(eprelLookups).values({ productId, status: "error" }).onConflictDoNothing();
    const counts = await eprelCounts(db);
    expect(counts.error).toBeGreaterThanOrEqual(1);
    expect(await retryEprelErrors(db)).toBeGreaterThanOrEqual(1);
    expect((await eprelCounts(db)).error ?? 0).toBe(0);
  });

  it("logs admin writes and keeps runtime flags", async () => {
    await audit(db, {
      adminEmail: "admin-stats@test",
      action: "offer.send",
      targetType: "offer",
      targetId: "x",
      details: { a: 1 },
      ip: "1.1.1.1",
    });
    await audit(db, { adminEmail: "admin-stats@test", action: "user.note" });
    const rows = (await recentAudit(db, 200)).filter((r) => r.adminEmail === "admin-stats@test");
    expect(rows.map((r) => r.action).sort()).toEqual(["offer.send", "user.note"]);
    expect(await offersPaused(db)).toBe(false);
    await setFlag(db, OFFERS_PAUSED, "1");
    await setFlag(db, OFFERS_PAUSED, "1");
    expect(await offersPaused(db)).toBe(true);
    expect(await getFlag(db, OFFERS_PAUSED)).toBe("1");
    await setFlag(db, OFFERS_PAUSED, null);
    expect(await getFlag(db, OFFERS_PAUSED)).toBeNull();
  });
});
