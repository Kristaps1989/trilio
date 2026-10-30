import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { token } from "@/services/offers/offers";

// Price-drop e-mails about saved items (docs/TRUST_POLISH_PLAN.md §1): free
// and on by default, because saving a product is asking to hear when it gets
// cheaper. Turned off with one tap under the heart, a switch in the account,
// or one click in any e-mail (RFC 8058), without signing in.

export async function priceAlertsOn(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ v: users.priceAlerts }).from(users).where(eq(users.id, userId));
  return row?.v ?? false;
}

export async function setPriceAlerts(db: Db, userId: string, on: boolean): Promise<void> {
  await db.update(users).set({ priceAlerts: on }).where(eq(users.id, userId));
}

/** The unsubscribe token for price-drop e-mails, created on first use. */
export async function ensureAlertsToken(db: Db, userId: string): Promise<string> {
  const [user] = await db.select({ t: users.alertsToken }).from(users).where(eq(users.id, userId));
  if (user?.t) return user.t;
  await db
    .update(users)
    .set({ alertsToken: token() })
    .where(and(eq(users.id, userId), isNull(users.alertsToken)));
  const [again] = await db.select({ t: users.alertsToken }).from(users).where(eq(users.id, userId));
  return again!.t!;
}

/** One-click unsubscribe from an e-mail; needs no sign-in. */
export async function unsubscribeAlertsByToken(db: Db, value: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return false;
  const rows = await db
    .update(users)
    .set({ priceAlerts: false })
    .where(eq(users.alertsToken, value))
    .returning({ id: users.id });
  return rows.length > 0;
}
