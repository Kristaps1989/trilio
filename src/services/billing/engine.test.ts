import { randomBytes } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { payments, plans, subscriptions, users } from "@/db/schema";
import { createMockProvider, mockComplete } from "@/services/payments/mock";
import {
  cancelAtPeriodEnd,
  chargeDueRenewals,
  currentSubscription,
  hasAccess,
  processPaymentEvent,
  resumeSubscription,
  startSubscription,
} from "./engine";

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

/**
 * The scheduler processes every due subscription in the database, and a
 * local database keeps the ones e2e runs create. Assertions look at ours.
 */
function ours<T extends { subscriptionId: string }>(results: T[], id: string): T[] {
  return results.filter((r) => r.subscriptionId === id);
}

const urls = { acceptUrl: "https://t/ok", cancelUrl: "https://t/no", callbackUrl: "https://t/cb" };

run("billing engine", () => {
  let db: Db;
  let end: () => Promise<void>;
  let userId: string;
  const provider = createMockProvider("http://localhost:3000", { recurring: true });

  beforeAll(async () => {
    process.env.PAYMENT_TOKEN_KEY = randomBytes(32).toString("hex");
    const created = createDb(url);
    db = created.db;
    end = () => created.client.end();
    await db.delete(users).where(like(users.email, "billing-test-%"));
    await db
      .insert(plans)
      .values({ id: "test-monthly", name: "Test", priceCents: 199, interval: "month" })
      .onConflictDoNothing();
    const [u] = await db
      .insert(users)
      .values({ email: `billing-test-${Date.now()}@example.invalid` })
      .returning();
    userId = u!.id;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await end();
  });

  it("start → captured notification activates with a token and one month of access; duplicates are ignored", async () => {
    const start = await startSubscription(db, provider, {
      userId,
      planId: "test-monthly",
      locale: "lv",
      urls,
      description: "Test",
    });
    expect(start.redirectUrl).toMatch(/^http:\/\/localhost:3000\/maksajums\/mock\?request=mock-pr-/);
    const pending = await currentSubscription(db, userId);
    expect(pending?.status).toBe("pending");
    expect(hasAccess(pending)).toBe(false);

    const [pay] = await db.select().from(payments).where(eq(payments.subscriptionId, start.subscriptionId));
    const notificationId = mockComplete(pay!.providerRequestId!);
    const event = await provider.fetchEvent({
      body: new URLSearchParams({ notification_id: notificationId! }).toString(),
      headers: new Headers(),
    });
    expect(await processPaymentEvent(db, provider, event!)).toBe("activated");
    expect(await processPaymentEvent(db, provider, event!)).toBe("duplicate");

    const sub = (await currentSubscription(db, userId))!;
    expect(sub.status).toBe("active");
    expect(sub.tokenEncrypted).toBeTruthy();
    expect(sub.tokenEncrypted).not.toContain("mock-token");
    expect(sub.paymentMethodLabel).toBe("•••• 4242");
    expect(hasAccess(sub)).toBe(true);
    const days = (sub.currentPeriodEnd!.getTime() - sub.currentPeriodStart!.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
    expect(sub.nextBillingAt!.getTime()).toBe(sub.currentPeriodEnd!.getTime());
  });

  it("renews when due, extends the period from the old end, and records the payment", async () => {
    const sub = (await currentSubscription(db, userId))!;
    const oldEnd = sub.currentPeriodEnd!;
    const results = await chargeDueRenewals(db, provider, urls, new Date(oldEnd.getTime() + 1000));
    expect(ours(results, sub.id)).toEqual([{ subscriptionId: sub.id, outcome: "renewed" }]);
    const after = (await currentSubscription(db, userId))!;
    expect(after.currentPeriodStart!.getTime()).toBe(oldEnd.getTime());
    expect(after.currentPeriodEnd!.getTime()).toBeGreaterThan(oldEnd.getTime());
    const rows = await db.select().from(payments).where(eq(payments.subscriptionId, sub.id));
    expect(rows.filter((p) => p.kind === "renewal" && p.status === "captured")).toHaveLength(1);
    // Not due yet → nothing happens
    expect(
      ours(await chargeDueRenewals(db, provider, urls, new Date(oldEnd.getTime() + 2000)), sub.id),
    ).toEqual([]);
  });

  it("a declined renewal goes past_due with retries, then expires after the last retry", async () => {
    const sub = (await currentSubscription(db, userId))!;
    const { encryptSecret } = await import("@/services/crypto");
    await db
      .update(subscriptions)
      .set({ tokenEncrypted: encryptSecret("fail-token") })
      .where(eq(subscriptions.id, sub.id));
    let now = new Date(sub.nextBillingAt!.getTime() + 1000);
    const r1 = ours(await chargeDueRenewals(db, provider, urls, now), sub.id);
    expect(r1[0]!.outcome).toBe("retry_scheduled");
    let s = (await currentSubscription(db, userId))!;
    expect(s.status).toBe("past_due");
    expect(s.failedAttempts).toBe(1);
    expect(hasAccess(s, now)).toBe(true); // grace: period not over yet
    for (const expected of ["retry_scheduled", "retry_scheduled", "expired"]) {
      now = new Date(s.nextBillingAt!.getTime() + 1000);
      const r = ours(await chargeDueRenewals(db, provider, urls, now), sub.id);
      expect(r[0]!.outcome).toBe(expected);
      s = (await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)))[0]!;
    }
    expect(s.status).toBe("expired");
    expect(hasAccess(s)).toBe(false);
    const rows = await db.select().from(payments).where(eq(payments.subscriptionId, sub.id));
    expect(rows.filter((p) => p.status === "failed")).toHaveLength(4);
  });

  it("cancel at period end keeps access until the end, resume undoes it, and the scheduler closes it", async () => {
    const [u2] = await db
      .insert(users)
      .values({ email: `billing-test-2-${Date.now()}@example.invalid` })
      .returning();
    const start = await startSubscription(db, provider, {
      userId: u2!.id,
      planId: "test-monthly",
      locale: "lv",
      urls,
      description: "T",
    });
    const [pay] = await db.select().from(payments).where(eq(payments.subscriptionId, start.subscriptionId));
    const nid = mockComplete(pay!.providerRequestId!);
    await processPaymentEvent(
      db,
      provider,
      (await provider.fetchEvent({
        body: new URLSearchParams({ notification_id: nid! }).toString(),
        headers: new Headers(),
      }))!,
    );

    expect(await cancelAtPeriodEnd(db, u2!.id)).toBe(true);
    let s = (await currentSubscription(db, u2!.id))!;
    expect(s.cancelAtPeriodEnd).toBe(true);
    expect(hasAccess(s)).toBe(true);
    expect(await resumeSubscription(db, u2!.id)).toBe(true);
    s = (await currentSubscription(db, u2!.id))!;
    expect(s.cancelAtPeriodEnd).toBe(false);
    await cancelAtPeriodEnd(db, u2!.id);
    const results = await chargeDueRenewals(db, provider, urls, new Date(s.nextBillingAt!.getTime() + 1000));
    expect(ours(results, s.id)).toEqual([{ subscriptionId: s.id, outcome: "skipped" }]);
    const closed = (await db.select().from(subscriptions).where(eq(subscriptions.id, s.id)))[0]!;
    expect(closed.status).toBe("canceled");
    expect(closed.nextBillingAt).toBeNull();
    await db.delete(users).where(eq(users.id, u2!.id));
  });
});
