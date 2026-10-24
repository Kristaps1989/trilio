import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { offerOrders, specialOffers } from "@/db/schema";

// Account deletion (GDPR) for offers and orders: offers that never became an
// order are deleted with their timeline. Orders that were placed stay, because
// invoices must be kept for accounting, but the phone, delivery note and
// locker are removed; the invoice keeps its own snapshot of name and address.

export async function forgetBuyer(db: Db, userId: string): Promise<{ offers: number; orders: number }> {
  const deleted = await db
    .delete(specialOffers)
    .where(
      and(
        eq(specialOffers.userId, userId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(offerOrders)
            .where(eq(offerOrders.offerId, specialOffers.id)),
        ),
      ),
    )
    .returning({ id: specialOffers.id });
  const unpaid = await db
    .select({ id: offerOrders.id })
    .from(offerOrders)
    .where(and(eq(offerOrders.userId, userId), isNull(offerOrders.paidAt)));
  if (unpaid.length)
    await db
      .update(offerOrders)
      .set({ status: "cancelled" })
      .where(
        and(
          inArray(
            offerOrders.id,
            unpaid.map((o) => o.id),
          ),
          eq(offerOrders.status, "awaiting_payment"),
        ),
      );
  const orders = await db
    .update(offerOrders)
    .set({ phone: null, deliveryNote: null, lockerId: null, feedbackNote: null, updatedAt: new Date() })
    .where(eq(offerOrders.userId, userId))
    .returning({ id: offerOrders.id });
  return { offers: deleted.length, orders: orders.length };
}
