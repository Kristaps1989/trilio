import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { offerEvents, offerOrders, specialOffers } from "@/db/schema";
import { feedbackDue, reminderDue, shouldExpire } from "@/domain/offers/offers";
import { sendOrderEmail, sendReminder, type MailDeps } from "./emails";
import { moveOrder } from "./orders";
import type { CarrierTracker } from "./tracking";
import { userLang } from "./texts";

// Housekeeping for offers and orders, run on every scheduler tick
// (docs/ADMIN_AND_OFFERS_PLAN.md §5, §10, §11): expire what passed its date,
// send the one reminder, ask "Viss kārtībā?" a week after delivery, and ask
// the carriers about parcels on the way.

export const TRACK_EVERY_MS = 10 * 3600 * 1000;

export type OffersJobResult = {
  expired: number;
  reminded: number;
  feedbackAsked: number;
  tracked: number;
  delivered: number;
};

export async function runOffersJob(
  db: Db,
  deps: MailDeps & { trackers?: CarrierTracker[]; now?: Date },
): Promise<OffersJobResult> {
  const now = deps.now ?? new Date();
  const result: OffersJobResult = { expired: 0, reminded: 0, feedbackAsked: 0, tracked: 0, delivered: 0 };

  const open = await db
    .select()
    .from(specialOffers)
    .where(inArray(specialOffers.status, ["sent", "opened", "accepted"]));
  for (const offer of open) {
    if (shouldExpire(offer, now)) {
      await db.update(specialOffers).set({ status: "expired" }).where(eq(specialOffers.id, offer.id));
      // An order nobody paid for closes with the offer.
      await db
        .update(offerOrders)
        .set({ status: "cancelled", updatedAt: now })
        .where(and(eq(offerOrders.offerId, offer.id), eq(offerOrders.status, "awaiting_payment")));
      await db.insert(offerEvents).values({ offerId: offer.id, kind: "expired", source: "system" });
      result.expired++;
      continue;
    }
    if (reminderDue(offer, now) && (await sendReminder(db, offer, deps))) {
      await db.update(specialOffers).set({ remindedAt: now }).where(eq(specialOffers.id, offer.id));
      await db.insert(offerEvents).values({ offerId: offer.id, kind: "reminded", source: "system" });
      result.reminded++;
    }
  }

  const delivered = await db
    .select({ order: offerOrders, offer: specialOffers })
    .from(offerOrders)
    .innerJoin(specialOffers, eq(specialOffers.id, offerOrders.offerId))
    .where(and(eq(offerOrders.status, "delivered"), isNull(offerOrders.feedbackAskedAt)));
  for (const { order, offer } of delivered) {
    if (!feedbackDue(order, now)) continue;
    await sendOrderEmail("feedback", order, offer, deps, { lang: await userLang(db, order.userId) });
    await db.update(offerOrders).set({ feedbackAskedAt: now }).where(eq(offerOrders.id, order.id));
    await db
      .insert(offerEvents)
      .values({ offerId: offer.id, orderId: order.id, kind: "feedback_asked", source: "system" });
    result.feedbackAsked++;
  }

  for (const tracker of deps.trackers ?? []) {
    const due = await db
      .select({ order: offerOrders, offer: specialOffers })
      .from(offerOrders)
      .innerJoin(specialOffers, eq(specialOffers.id, offerOrders.offerId))
      .where(
        and(
          eq(offerOrders.status, "shipped"),
          eq(offerOrders.carrier, tracker.carrier),
          or(
            isNull(offerOrders.lastTrackedAt),
            lt(offerOrders.lastTrackedAt, new Date(now.getTime() - TRACK_EVERY_MS)),
          ),
        ),
      )
      .limit(tracker.perRun);
    for (const { order, offer } of due) {
      if (!order.trackingNumber) continue;
      const status = await tracker.track(order.trackingNumber);
      await db.update(offerOrders).set({ lastTrackedAt: now }).where(eq(offerOrders.id, order.id));
      result.tracked++;
      if (!status?.delivered) continue;
      const moved = await moveOrder(db, order.id, {
        to: "delivered",
        by: "carrier",
        at: status.at && status.at.getTime() <= now.getTime() ? status.at : now,
        note: status.lastEvent ?? undefined,
      });
      if (moved.ok) {
        await sendOrderEmail("delivered", moved.order, offer, deps, {
          lang: await userLang(db, moved.order.userId),
        });
        result.delivered++;
      }
    }
  }
  return result;
}
