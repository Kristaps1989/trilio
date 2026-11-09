import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  accounts,
  notifyRequests,
  offerEvents,
  offerOrders,
  products,
  savedItems,
  specialOffers,
  users,
} from "@/db/schema";
import { RENEW_NOTICE_DAYS, alertsUntilFrom } from "@/domain/notify/notify";
import { formatDayLocative } from "@/i18n/format";
import en from "@/i18n/messages/en.json";
import lv from "@/i18n/messages/lv.json";
import { isUiLocale, localizedPath, type UiLocale } from "@/i18n/routing";
import type { EmailSender } from "@/services/notify/email";
import { offerProductName } from "@/services/offers/compose";
import { button, centred, emailShell, esc, hero, paragraph } from "@/services/offers/mail-layout";
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

/** One-click unsubscribe from an e-mail; needs no sign-in (see unsubscribeAlerts). */
export async function unsubscribeAlertsByToken(db: Db, value: string): Promise<boolean> {
  return (await unsubscribeAlerts(db, value)) !== null;
}

// ------------------------------------------------- 90 days (docs/ALERTS_WITHOUT_CONFIRM_PLAN.md)

/**
 * Whether the person has ever proven the address: a magic link, the offer or request
 * link (emailVerified), or a Google sign-in (an accounts row). An account made by a
 * typed request alone has neither.
 */
export async function addressProven(db: Db, userId: string): Promise<boolean> {
  const [u] = await db.select({ v: users.emailVerified }).from(users).where(eq(users.id, userId));
  if (u?.v) return true;
  const [a] = await db
    .select({ id: accounts.userId })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);
  return !!a;
}

/**
 * The unsubscribe in every price e-mail. For an address never proven (an account made by
 * a typed request) it stops everything, as the receipt promises: Trilio's offers off, open
 * proposals cancelled, and its saved items and requests deleted. Returns what was done.
 */
export async function unsubscribeAlerts(db: Db, value: string): Promise<"alerts" | "request" | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return null;
  const rows = await db
    .update(users)
    .set({ priceAlerts: false })
    .where(eq(users.alertsToken, value))
    .returning({ id: users.id });
  const userId = rows[0]?.id;
  if (!userId) return null;
  if (await addressProven(db, userId)) return "alerts";
  await db.update(users).set({ offersOptIn: false, offersOptInAt: null }).where(eq(users.id, userId));
  const open = await db
    .update(specialOffers)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(eq(specialOffers.userId, userId), inArray(specialOffers.status, ["draft", "sent", "opened"])))
    .returning({ id: specialOffers.id });
  if (open.length)
    await db
      .insert(offerEvents)
      .values(open.map((o) => ({ offerId: o.id, kind: "cancelled", source: "buyer", note: "unsubscribed" })));
  await db.delete(savedItems).where(eq(savedItems.userId, userId));
  await db
    .delete(notifyRequests)
    .where(and(eq(notifyRequests.userId, userId), isNull(notifyRequests.confirmedAt)));
  return "request";
}

/** "Turpināt vēl 90 dienas": every item of this person runs 90 days from now. Null for an unknown link. */
export async function renewAlertsByToken(db: Db, value: string, now = new Date()): Promise<Date | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return null;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.alertsToken, value));
  if (!user) return null;
  const until = alertsUntilFrom(now);
  await db
    .update(savedItems)
    .set({
      alertsUntil: sql`greatest(${savedItems.alertsUntil}, ${until.toISOString()}::timestamptz)`,
      renewalSentAt: null,
    })
    .where(eq(savedItems.userId, user.id));
  await db.update(users).set({ priceAlerts: true }).where(eq(users.id, user.id));
  return until;
}

export type RenewalTexts = {
  subject: string;
  title: string;
  intro: string;
  ends: (v: { date: string }) => string;
  button: string;
  link: (v: { url: string }) => string;
  thenDeleted: (v: { date: string }) => string;
  thenStopped: (v: { date: string }) => string;
  unsubscribe: string;
  unsubscribeLine: (v: { url: string }) => string;
};

export type RenewalDeps = {
  email: EmailSender;
  baseUrl: string;
  company?: string;
  texts: (lang: UiLocale) => RenewalTexts;
  now?: Date;
};

export type RenewalResult = { asked: number; deleted: number; usersDeleted: number };

/**
 * Daily (housekeeping): 7 days before an item's 90 days end, one e-mail per person asks
 * whether to continue; when they end unrenewed, an unproven address's items (and then
 * the empty account) are deleted, a proven one keeps its wishlist and its e-mails stop.
 */
export async function runAlertRenewals(db: Db, deps: RenewalDeps): Promise<RenewalResult> {
  const now = deps.now ?? new Date();
  const result: RenewalResult = { asked: 0, deleted: 0, usersDeleted: 0 };
  const soon = new Date(now.getTime() + RENEW_NOTICE_DAYS * 24 * 3600 * 1000);
  const due = await db
    .select({
      item: savedItems,
      email: users.email,
      locale: users.locale,
      productName: products.name,
    })
    .from(savedItems)
    .innerJoin(users, eq(users.id, savedItems.userId))
    .leftJoin(products, eq(products.id, savedItems.productId))
    .where(
      and(
        gt(savedItems.alertsUntil, now),
        lte(savedItems.alertsUntil, soon),
        isNull(savedItems.renewalSentAt),
        eq(users.priceAlerts, true),
      ),
    );
  const byUser = new Map<string, typeof due>();
  for (const row of due) byUser.set(row.item.userId, [...(byUser.get(row.item.userId) ?? []), row]);
  for (const [userId, rows] of byUser) {
    const lang: UiLocale = isUiLocale(rows[0]!.locale) ? rows[0]!.locale : "lv";
    const t = deps.texts(lang);
    const ends = new Date(Math.min(...rows.map((r) => r.item.alertsUntil.getTime())));
    const date = formatDayLocative(ends, lang);
    const token = await ensureAlertsToken(db, userId);
    const renewUrl = `${deps.baseUrl}${localizedPath(`/velmju-saraksts/turpinat/${token}`, lang)}`;
    const unsubscribeUrl = `${deps.baseUrl}${localizedPath(`/velmju-saraksts/atteikties/${token}`, lang)}`;
    const names = rows.map((r) =>
      r.item.kind === "product" && r.productName ? offerProductName(r.productName) : (r.item.label ?? ""),
    );
    const then = (await addressProven(db, userId)) ? t.thenStopped({ date }) : t.thenDeleted({ date });
    const text = [
      t.intro,
      names.map((n) => `• ${n}`).join("\n"),
      t.ends({ date }),
      t.link({ url: renewUrl }),
      then,
      t.unsubscribeLine({ url: unsubscribeUrl }),
    ].join("\n\n");
    const body = [
      hero(t.title),
      centred(t.intro),
      paragraph(names.map((n) => esc(n)).join("<br>"), "font-weight:600"),
      centred(t.ends({ date })),
      button(t.button, renewUrl),
      paragraph(then, "font-size:14px"),
    ].join("");
    const sent = await deps.email.send({
      to: rows[0]!.email,
      subject: t.subject,
      text,
      html: emailShell({
        lang,
        title: t.subject,
        baseUrl: deps.baseUrl,
        tagline: (lang === "en" ? en : lv).offerEmail.tagline,
        body,
        footer: [deps.company ?? ""],
        unsubscribe: { label: t.unsubscribe, url: unsubscribeUrl },
      }),
      headers: {
        "List-Unsubscribe": `<${deps.baseUrl}/api/wishlist/unsubscribe/${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (!sent.ok && sent.reason === "error") continue;
    await db
      .update(savedItems)
      .set({ renewalSentAt: now })
      .where(
        inArray(
          savedItems.id,
          rows.map((r) => r.item.id),
        ),
      );
    result.asked++;
  }

  // Ended unrenewed: an unproven address's request is deleted (owner, 9 Nov 2026).
  const ended = await db
    .select({ id: savedItems.id, userId: savedItems.userId })
    .from(savedItems)
    .where(lte(savedItems.alertsUntil, now));
  const owners = [...new Set(ended.map((e) => e.userId))];
  for (const userId of owners) {
    if (await addressProven(db, userId)) continue;
    const gone = await db
      .delete(savedItems)
      .where(and(eq(savedItems.userId, userId), lte(savedItems.alertsUntil, now)))
      .returning({ id: savedItems.id });
    result.deleted += gone.length;
    // The account goes too once nothing is left: no saves, no proposals, no orders.
    const [left] = await db
      .select({ id: savedItems.id })
      .from(savedItems)
      .where(eq(savedItems.userId, userId))
      .limit(1);
    const [offer] = await db
      .select({ id: specialOffers.id })
      .from(specialOffers)
      .where(eq(specialOffers.userId, userId))
      .limit(1);
    const [order] = await db
      .select({ id: offerOrders.id })
      .from(offerOrders)
      .where(eq(offerOrders.userId, userId))
      .limit(1);
    if (!left && !offer && !order) {
      await db.delete(users).where(eq(users.id, userId));
      result.usersDeleted++;
    }
  }
  return result;
}

/** What the unsubscribe link stops: an account's price e-mails, or an unproven request outright. */
export async function alertsUnsubscribeKind(db: Db, value: string): Promise<"alerts" | "request" | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return null;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.alertsToken, value));
  if (!user) return null;
  return (await addressProven(db, user.id)) ? "alerts" : "request";
}
