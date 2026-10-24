import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import {
  accounts,
  db,
  invoices,
  notifySettings,
  offerOrders,
  specialOffers,
  payments,
  radarEvents,
  radars,
  savedItems,
  searchSessions,
  subscriptions,
  users,
} from "@/db";

// GDPR data portability: everything we hold about the user, as JSON.
// Secrets (billing token) and provider ids are left out.

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "auth" }, { status: 401 });

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      locale: users.locale,
      offersOptIn: users.offersOptIn,
      offersOptInAt: users.offersOptInAt,
      adminNote: users.adminNote,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  const providers = await db
    .select({ provider: accounts.provider })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  const saved = await db.select().from(savedItems).where(eq(savedItems.userId, userId));
  const notify = await db.select().from(notifySettings).where(eq(notifySettings.userId, userId));
  // Radars from before the wishlist (19–20 Oct 2026), if any.
  const radarRows = await db.select().from(radars).where(eq(radars.userId, userId));
  const radarIds = radarRows.map((r) => r.id);
  const events = radarIds.length
    ? await db.select().from(radarEvents).where(inArray(radarEvents.radarId, radarIds))
    : [];
  const sessionIds = radarRows.map((r) => r.searchSessionId).filter((id): id is string => !!id);
  const sessions = sessionIds.length
    ? await db.select().from(searchSessions).where(inArray(searchSessions.id, sessionIds))
    : [];
  const subs = await db
    .select({
      id: subscriptions.id,
      planId: subscriptions.planId,
      status: subscriptions.status,
      paymentMethodLabel: subscriptions.paymentMethodLabel,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      createdAt: subscriptions.createdAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  const subIds = subs.map((s) => s.id);
  const pays = subIds.length
    ? await db
        .select({
          orderId: payments.orderId,
          kind: payments.kind,
          amountCents: payments.amountCents,
          currency: payments.currency,
          status: payments.status,
          paidAt: payments.paidAt,
        })
        .from(payments)
        .where(inArray(payments.subscriptionId, subIds))
    : [];

  // Personal offers and orders; the admin's purchase price and supplier stay out (not personal data).
  const offers = await db
    .select({
      id: specialOffers.id,
      productName: specialOffers.productName,
      condition: specialOffers.condition,
      priceCents: specialOffers.priceCents,
      validUntil: specialOffers.validUntil,
      message: specialOffers.message,
      status: specialOffers.status,
      sentAt: specialOffers.sentAt,
      openedAt: specialOffers.openedAt,
      createdAt: specialOffers.createdAt,
    })
    .from(specialOffers)
    .where(eq(specialOffers.userId, userId));
  const orders = await db.select().from(offerOrders).where(eq(offerOrders.userId, userId));
  const orderIds = orders.map((o) => o.id);
  const orderInvoices = orderIds.length
    ? await db.select().from(invoices).where(inArray(invoices.orderId, orderIds))
    : [];
  const orderPayments = orderIds.length
    ? await db
        .select({
          orderId: payments.orderId,
          kind: payments.kind,
          amountCents: payments.amountCents,
          status: payments.status,
          paidAt: payments.paidAt,
        })
        .from(payments)
        .where(inArray(payments.offerOrderId, orderIds))
    : [];

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      user,
      signInProviders: providers.map((p) => p.provider),
      wishlist: saved,
      notificationSettings: notify,
      radars: radarRows,
      radarEvents: events,
      savedAnswers: sessions,
      subscriptions: subs,
      payments: [...pays, ...orderPayments],
      offers,
      orders: orders.map((o) => ({ ...o, feedbackToken: undefined })),
      invoices: orderInvoices,
    },
    {
      headers: {
        "cache-control": "no-store",
        "content-disposition": 'attachment; filename="trilio-dati.json"',
      },
    },
  );
}
