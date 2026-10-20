import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, payments, plans, subscriptions, users } from "@/db";
import { formatDateNominative, formatEur } from "@/i18n/format";
import { processPaymentEvent } from "@/services/billing/engine";
import { createEmailSender } from "@/services/notify/email";
import { paymentsProvider } from "@/services/payments";
import { billingTexts } from "@/services/texts";

// Paysera posts `notification_id=…` (form-encoded) here. The body is never
// trusted on its own: the event is fetched from the provider with MAC
// auth, processed once (idempotent by notification id and order id), and
// then acknowledged so Paysera stops retrying.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const provider = paymentsProvider();
  if (!provider) return new NextResponse(null, { status: 404 });
  const raw = await request.text();
  const event = await provider
    .fetchEvent({ body: raw.slice(0, 65_536), headers: request.headers })
    .catch(() => null);
  if (!event) return new NextResponse("ignored", { status: 200 });

  const outcome = await processPaymentEvent(db, provider, event);
  await provider.acknowledge(event.notificationId).catch(() => undefined);

  if (outcome === "activated" || outcome === "renewed") {
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, event.orderId));
    const [sub] = payment
      ? await db.select().from(subscriptions).where(eq(subscriptions.id, payment.subscriptionId))
      : [];
    const [user] = sub
      ? await db.select({ email: users.email }).from(users).where(eq(users.id, sub.userId))
      : [];
    const [plan] = sub ? await db.select().from(plans).where(eq(plans.id, sub.planId)) : [];
    if (user && plan && sub) {
      const texts = billingTexts();
      const amount = formatEur(plan.priceCents);
      await createEmailSender().send({
        to: user.email,
        subject: texts.receiptSubject({ amount }),
        text: texts.receiptBody({
          amount,
          next: sub.nextBillingAt ? formatDateNominative(sub.nextBillingAt) : "—",
        }),
      });
    }
  }
  return new NextResponse("OK", { status: 200, headers: { "cache-control": "no-store" } });
}
