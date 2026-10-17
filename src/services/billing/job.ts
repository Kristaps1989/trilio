import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { plans, subscriptions, users } from "@/db/schema";
import { formatDateNominative, formatEur } from "@/i18n/format";
import type { EmailSender } from "@/services/notify/email";
import type { PaymentProvider } from "@/services/payments/types";
import { chargeDueRenewals, type BillingUrls, type RenewalResult } from "./engine";

// Scheduled billing: charge due renewals and tell the customer what happened.

export type BillingTexts = {
  receiptSubject: (v: { amount: string }) => string;
  receiptBody: (v: { amount: string; next: string }) => string;
  failedSubject: string;
  failedBody: (v: { amount: string; next: string }) => string;
  expired: string;
};

export async function runBillingJob(
  db: Db,
  provider: PaymentProvider,
  deps: { email: EmailSender; urls: BillingUrls; texts: BillingTexts; now?: Date },
): Promise<RenewalResult[]> {
  const now = deps.now ?? new Date();
  const results = await chargeDueRenewals(db, provider, deps.urls, now);
  for (const r of results) {
    if (r.outcome === "skipped") continue;
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, r.subscriptionId));
    if (!sub) continue;
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, sub.userId));
    if (!user) continue;
    const [plan] = await db.select().from(plans).where(eq(plans.id, sub.planId));
    const amount = formatEur(plan?.priceCents ?? 0);
    if (r.outcome === "renewed") {
      await deps.email.send({
        to: user.email,
        subject: deps.texts.receiptSubject({ amount }),
        text: deps.texts.receiptBody({
          amount,
          next: sub.nextBillingAt ? formatDateNominative(sub.nextBillingAt) : "—",
        }),
      });
    } else if (r.outcome === "retry_scheduled") {
      await deps.email.send({
        to: user.email,
        subject: deps.texts.failedSubject,
        text: deps.texts.failedBody({
          amount,
          next: sub.nextBillingAt ? formatDateNominative(sub.nextBillingAt) : "—",
        }),
      });
    } else if (r.outcome === "expired") {
      await deps.email.send({ to: user.email, subject: deps.texts.failedSubject, text: deps.texts.expired });
    }
  }
  return results;
}
