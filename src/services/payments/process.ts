import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { paymentNotifications, payments } from "@/db/schema";
import { orderPaymentCaptured } from "@/services/offers/orders";
import type { PaymentEvent, PaymentProvider } from "./types";

// A verified provider event for a personal offer bought from Trilio
// (services/offers/orders.ts). Payments are one-off: the paid price-alert
// plan is gone (owner, 30 Oct 2026; docs/PRICE_NOTIFY_PLAN.md §4), so an event
// for anything else is ignored. Idempotent by notification id and order id.

export type ProcessOutcome = "order_paid" | "canceled" | "duplicate" | "ignored";

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
  if (!payment?.offerOrderId) return "ignored";
  if (event.status === "canceled") {
    if (payment.status === "pending")
      await db.update(payments).set({ status: "canceled" }).where(eq(payments.id, payment.id));
    return "canceled";
  }
  if (event.status !== "captured" || payment.status === "captured") return "ignored";
  return orderPaymentCaptured(db, payment, event);
}
