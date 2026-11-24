import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, payments } from "@/db";
import { processPaymentEvent } from "@/services/payments/process";
import { paymentsProvider } from "@/services/payments";
import { offerMailDeps } from "@/services/offers/deps";
import { afterOrderPaid } from "@/services/offers/notify";

// Paysera's callback for a payment (docs/PAYMENTS.md). The body is never trusted
// on its own: the provider checks its signature (Checkout) or fetches the event
// itself (the older API). An event is processed once, by its id and by our order
// reference; a paid order then gets its final invoice and the buyer the
// confirmation with the guarantee sheet.

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

  if (outcome === "order_paid") {
    const [payment] = await db.select().from(payments).where(eq(payments.orderId, event.orderId));
    if (payment?.offerOrderId) await afterOrderPaid(db, payment.offerOrderId, offerMailDeps());
  }
  return new NextResponse("OK", { status: 200, headers: { "cache-control": "no-store" } });
}
