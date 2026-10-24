import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  paymentNotifications,
  payments,
  plans,
  subscriptions,
  users,
  type Plan,
  type Subscription,
} from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/services/crypto";
import type { PaymentEvent, PaymentProvider } from "@/services/payments/types";
import { orderPaymentCaptured } from "@/services/offers/orders";
import { addInterval, MAX_FAILED_ATTEMPTS, nextRetryAt } from "./dates";

// Subscription lifecycle (spec §5): we own plans, billing dates, renewals,
// retries and access; the provider only moves money and issues a token.
// Every provider notification is processed once (payment_notifications).

export type StartResult = { subscriptionId: string; redirectUrl: string | null };

export type BillingUrls = { acceptUrl: string; cancelUrl: string; callbackUrl: string };

export async function activePlans(db: Db): Promise<Plan[]> {
  return db.select().from(plans).where(eq(plans.active, true));
}

export async function currentSubscription(db: Db, userId: string): Promise<Subscription | null> {
  const [s] = await db
    .select()
    .from(subscriptions)
    .where(
      and(eq(subscriptions.userId, userId), inArray(subscriptions.status, ["active", "past_due", "pending"])),
    )
    .orderBy(sql`${subscriptions.createdAt} desc`)
    .limit(1);
  return s ?? null;
}

/** Access to the radar: active, or past_due within the grace period, or canceled-at-period-end until it ends. */
export function hasAccess(sub: Subscription | null, now = new Date()): boolean {
  if (!sub) return false;
  if (sub.status === "active") return !sub.currentPeriodEnd || sub.currentPeriodEnd > now;
  // While a renewal is being retried (1, 3, 5 days) access continues until the next attempt.
  if (sub.status === "past_due") return !!sub.nextBillingAt && sub.nextBillingAt > now;
  if (sub.status === "canceled") return !!sub.currentPeriodEnd && sub.currentPeriodEnd > now;
  return false;
}

function orderId(subscriptionId: string, attempt: number): string {
  return `TRILIO-${subscriptionId.replace(/-/g, "").slice(0, 12).toUpperCase()}-${Date.now().toString(36)}-${attempt}`;
}

/** Step 1–2 of the Paysera flow: pending subscription + initial payment request; redirect to hosted checkout. */
export async function startSubscription(
  db: Db,
  provider: PaymentProvider,
  input: { userId: string; planId: string; locale: string; urls: BillingUrls; description: string },
): Promise<StartResult> {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, input.planId), eq(plans.active, true)));
  if (!plan) throw new Error("unknown plan");
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, input.userId));
  if (!user) throw new Error("unknown user");

  const existing = await currentSubscription(db, input.userId);
  if (existing && existing.status !== "pending") return { subscriptionId: existing.id, redirectUrl: null };

  const [sub] = existing
    ? [existing]
    : await db
        .insert(subscriptions)
        .values({ userId: input.userId, planId: plan.id, status: "pending", provider: provider.name })
        .returning();
  const oid = orderId(sub!.id, 1);
  const [payment] = await db
    .insert(payments)
    .values({
      subscriptionId: sub!.id,
      orderId: oid,
      kind: "initial",
      amountCents: plan.priceCents,
      currency: plan.currency,
    })
    .returning();
  const created = await provider.createPayment({
    orderId: oid,
    amountCents: plan.priceCents,
    currency: "EUR",
    description: input.description,
    payerEmail: user.email,
    locale: input.locale,
    acceptUrl: input.urls.acceptUrl,
    cancelUrl: input.urls.cancelUrl,
    callbackUrl: input.urls.callbackUrl,
    requestToken: true,
  });
  await db
    .update(payments)
    .set({ providerRequestId: created.providerRequestId })
    .where(eq(payments.id, payment!.id));
  return { subscriptionId: sub!.id, redirectUrl: created.redirectUrl };
}

export type ProcessOutcome = "activated" | "renewed" | "order_paid" | "canceled" | "duplicate" | "ignored";

/** Step 3: a verified provider event. Idempotent by notification id and by order id. */
export async function processPaymentEvent(
  db: Db,
  provider: PaymentProvider,
  event: PaymentEvent,
): Promise<ProcessOutcome> {
  const inserted = await db
    .insert(paymentNotifications)
    .values({ provider: provider.name, notificationId: event.notificationId, event: event.event })
    .onConflictDoNothing()
    .returning({ id: paymentNotifications.id });
  if (inserted.length === 0) return "duplicate";

  const [payment] = await db.select().from(payments).where(eq(payments.orderId, event.orderId));
  if (!payment) return "ignored";
  // A personal offer bought from Trilio (services/offers/orders.ts), not the e-mail service.
  if (payment.offerOrderId) {
    if (event.status === "canceled") {
      if (payment.status === "pending")
        await db.update(payments).set({ status: "canceled" }).where(eq(payments.id, payment.id));
      return "canceled";
    }
    if (event.status !== "captured" || payment.status === "captured") return "ignored";
    return orderPaymentCaptured(db, payment, event);
  }
  if (!payment.subscriptionId) return "ignored";
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, payment.subscriptionId));
  const [plan] = sub ? await db.select().from(plans).where(eq(plans.id, sub.planId)) : [];
  if (!sub || !plan) return "ignored";

  if (event.status === "canceled") {
    if (payment.status === "pending")
      await db.update(payments).set({ status: "canceled" }).where(eq(payments.id, payment.id));
    return "canceled";
  }
  if (event.status !== "captured" || payment.status === "captured") return "ignored";
  if (event.amountCents !== null && event.amountCents !== payment.amountCents) {
    await db
      .update(payments)
      .set({ status: "failed", error: "amount_mismatch" })
      .where(eq(payments.id, payment.id));
    return "ignored";
  }

  const now = new Date();
  await db
    .update(payments)
    .set({ status: "captured", paidAt: now, providerRequestId: event.providerRequestId })
    .where(eq(payments.id, payment.id));
  const periodStart = sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
  const periodEnd = addInterval(periodStart, plan.interval);
  await db
    .update(subscriptions)
    .set({
      status: "active",
      tokenEncrypted: event.issuedToken ? encryptSecret(event.issuedToken) : sub.tokenEncrypted,
      paymentMethodLabel: event.paymentMethodLabel ?? sub.paymentMethodLabel,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      nextBillingAt: periodEnd,
      failedAttempts: 0,
      updatedAt: now,
    })
    .where(eq(subscriptions.id, sub.id));
  return payment.kind === "initial" ? "activated" : "renewed";
}

export type RenewalResult = {
  subscriptionId: string;
  outcome: "renewed" | "retry_scheduled" | "expired" | "skipped";
};

/** Step 4–5: charge every subscription whose next billing date has passed. Run by the scheduler. */
export async function chargeDueRenewals(
  db: Db,
  provider: PaymentProvider,
  urls: BillingUrls,
  now = new Date(),
  description = "Trilio cenu paziņojumi",
): Promise<RenewalResult[]> {
  const due = await db
    .select()
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, ["active", "past_due"]), lte(subscriptions.nextBillingAt, now)));
  const results: RenewalResult[] = [];
  for (const sub of due) {
    if (sub.cancelAtPeriodEnd) {
      await db
        .update(subscriptions)
        .set({ status: "canceled", canceledAt: now, nextBillingAt: null, updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      results.push({ subscriptionId: sub.id, outcome: "skipped" });
      continue;
    }
    if (!sub.tokenEncrypted) {
      results.push({ subscriptionId: sub.id, outcome: "skipped" });
      continue;
    }
    const [plan] = await db.select().from(plans).where(eq(plans.id, sub.planId));
    const [user] = await db
      .select({ email: users.email, locale: users.locale })
      .from(users)
      .where(eq(users.id, sub.userId));
    if (!plan || !user) continue;
    const attempt = sub.failedAttempts + 1;
    const oid = orderId(sub.id, attempt);
    const [payment] = await db
      .insert(payments)
      .values({
        subscriptionId: sub.id,
        orderId: oid,
        kind: "renewal",
        amountCents: plan.priceCents,
        currency: plan.currency,
        attemptNumber: attempt,
      })
      .returning();
    const charge = await provider.chargeToken(
      {
        orderId: oid,
        amountCents: plan.priceCents,
        currency: "EUR",
        description,
        payerEmail: user.email,
        locale: user.locale,
        ...urls,
      },
      decryptSecret(sub.tokenEncrypted),
    );
    if (charge.ok) {
      await db
        .update(payments)
        .set({ status: "captured", paidAt: charge.capturedAt, providerRequestId: charge.providerRequestId })
        .where(eq(payments.id, payment!.id));
      const periodStart = sub.currentPeriodEnd ?? now;
      const periodEnd = addInterval(periodStart, plan.interval);
      await db
        .update(subscriptions)
        .set({
          status: "active",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          nextBillingAt: periodEnd,
          failedAttempts: 0,
          paymentMethodLabel: charge.paymentMethodLabel ?? sub.paymentMethodLabel,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, sub.id));
      results.push({ subscriptionId: sub.id, outcome: "renewed" });
      continue;
    }
    await db
      .update(payments)
      .set({ status: "failed", error: charge.reason, providerRequestId: charge.providerRequestId })
      .where(eq(payments.id, payment!.id));
    const retryAt = charge.retryable ? nextRetryAt(attempt, now) : null;
    if (retryAt && attempt <= MAX_FAILED_ATTEMPTS) {
      await db
        .update(subscriptions)
        .set({ status: "past_due", failedAttempts: attempt, nextBillingAt: retryAt, updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      results.push({ subscriptionId: sub.id, outcome: "retry_scheduled" });
    } else {
      await db
        .update(subscriptions)
        .set({ status: "expired", failedAttempts: attempt, nextBillingAt: null, updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      results.push({ subscriptionId: sub.id, outcome: "expired" });
    }
  }
  return results;
}

/** "Atteikties no abonementa": access continues until the paid period ends; no further charges. */
export async function cancelAtPeriodEnd(db: Db, userId: string): Promise<boolean> {
  const sub = await currentSubscription(db, userId);
  if (!sub || sub.status === "pending") return false;
  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));
  return true;
}

/** "Atjaunot abonementu": undo a pending cancellation. */
export async function resumeSubscription(db: Db, userId: string): Promise<boolean> {
  const sub = await currentSubscription(db, userId);
  if (!sub || !sub.cancelAtPeriodEnd) return false;
  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: false, updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));
  return true;
}
