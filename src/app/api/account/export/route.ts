import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUserId } from "@/auth";
import { accounts, db, payments, radarEvents, radars, searchSessions, subscriptions, users } from "@/db";

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
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  const providers = await db
    .select({ provider: accounts.provider })
    .from(accounts)
    .where(eq(accounts.userId, userId));
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

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      user,
      signInProviders: providers.map((p) => p.provider),
      radars: radarRows,
      radarEvents: events,
      savedAnswers: sessions,
      subscriptions: subs,
      payments: pays,
    },
    {
      headers: {
        "cache-control": "no-store",
        "content-disposition": 'attachment; filename="trilio-dati.json"',
      },
    },
  );
}
