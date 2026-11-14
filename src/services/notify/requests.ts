import { and, count, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { notifyRequests, specialOffers, users, type NotifyRequest } from "@/db/schema";
import {
  REQUEST_TTL_MS,
  activeOnRequest,
  consentFor,
  normaliseEmail,
  rateLimit,
  requestState,
  safeReturnPath,
  type NotifyKind,
} from "@/domain/notify/notify";
import { trilioSources, worthAsking, type Sourcing } from "@/domain/offers/sourcing";
import type { EmailSender } from "@/services/notify/email";
import { token } from "@/services/offers/offers";
import { ensureAlertsToken } from "@/services/wishlist/alerts";
import { localizedPath } from "@/i18n/routing";
import type { UiLocale } from "@/i18n/routing";
import { composeNotifyConfirmEmail } from "./confirm-email";

// "Iegūt lētāk" without an account. The request holds what was asked and the consent
// text shown. Since consent 2026-11-09.2 entering the e-mail is the consent (lawyer and
// owner, 9 Nov 2026; docs/ALERTS_WITHOUT_CONFIRM_PLAN.md): the item is saved to an account
// for that address at once and the price e-mails start, for 90 days, each with an
// unsubscribe. The e-mail sent now is a receipt; its link opens the wishlist, signs the
// person in once and proves the address. Older requests still wait for that click.

export type NotifyTarget =
  | {
      kind: "product";
      productId: string;
      subcategoryId: string;
      name: string;
      priceCents: number | null;
      imageUrl: string | null;
    }
  | { kind: "search"; subcategoryId: string; answersParam: string; label: string };

export type RequestInput = {
  email: unknown;
  target: NotifyTarget;
  returnPath: unknown;
  locale: UiLocale;
  visitorHash: string | null;
  adLandingId: string | null;
  now?: Date;
};

export type RequestDeps = {
  email: EmailSender;
  baseUrl: string;
  company?: string;
  inbox?: string;
  /** Where Trilio sources; data/offers.json (every category) unless a test narrows it. */
  sourcing?: Sourcing;
  /** Saves the asked item to the account (the wishlist's own save, with today's price as the baseline). */
  save: (userId: string, request: NotifyRequest) => Promise<boolean>;
};

export type RequestResult =
  { ok: true; email: string; id: string } | { ok: false; reason: "invalid" | "too_many" | "email_failed" };

const DAY_MS = 24 * 3600 * 1000;

export async function requestNotify(db: Db, input: RequestInput, deps: RequestDeps): Promise<RequestResult> {
  const email = normaliseEmail(input.email);
  if (!email) return { ok: false, reason: "invalid" };
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - DAY_MS);
  const [byEmail] = await db
    .select({ n: count() })
    .from(notifyRequests)
    .where(and(eq(notifyRequests.email, email), gte(notifyRequests.createdAt, since)));
  const [byVisitor] = input.visitorHash
    ? await db
        .select({ n: count() })
        .from(notifyRequests)
        .where(and(eq(notifyRequests.visitorHash, input.visitorHash), gte(notifyRequests.createdAt, since)))
    : [{ n: 0 }];
  if (rateLimit({ email: Number(byEmail?.n ?? 0), visitor: Number(byVisitor?.n ?? 0) }) === "too_many")
    return { ok: false, reason: "too_many" };

  const t = input.target;
  // A product too cheap to be worth a request gets the plain price alert and its consent text.
  const sourced =
    t.kind === "product"
      ? worthAsking(t.subcategoryId, t.priceCents, deps.sourcing)
      : trilioSources(t.subcategoryId, deps.sourcing);
  const consent = consentFor(t.kind as NotifyKind, sourced);
  const value = token();
  const [row] = await db
    .insert(notifyRequests)
    .values({
      token: value,
      email,
      kind: t.kind,
      productId: t.kind === "product" ? t.productId : null,
      subcategoryId: t.subcategoryId,
      answersParam: t.kind === "search" ? t.answersParam : null,
      label: t.kind === "search" ? t.label : t.name,
      returnPath: safeReturnPath(input.returnPath),
      locale: input.locale,
      consent: consent.key,
      offers: consent.offers,
      visitorHash: input.visitorHash,
      adLandingId: input.adLandingId,
      createdAt: now,
    })
    .returning({ id: notifyRequests.id });
  const [request] = await db.select().from(notifyRequests).where(eq(notifyRequests.id, row!.id));
  // Every request now shows a text under which entering the e-mail is the consent.
  const active = activeOnRequest(consent.key) ? await activateRequest(db, request!, deps.save, now) : null;
  if (!active) {
    await db.delete(notifyRequests).where(eq(notifyRequests.id, row!.id));
    return { ok: false, reason: "invalid" };
  }
  const unsubscribeToken = await ensureAlertsToken(db, active.userId);
  const sent = await deps.email.send(
    composeNotifyConfirmEmail({
      to: email,
      lang: input.locale,
      baseUrl: deps.baseUrl,
      company: deps.company,
      token: value,
      target: t,
      offers: consent.offers,
      alertsOff: active.alertsOff,
      unsubscribeUrl: `${deps.baseUrl}${localizedPath(`/velmju-saraksts/atteikties/${unsubscribeToken}`, input.locale)}`,
      oneClickUrl: `${deps.baseUrl}/api/wishlist/unsubscribe/${unsubscribeToken}`,
    }),
  );
  // Already saved and running (its e-mails carry the unsubscribe); the person sees the failure.
  if (!sent.ok && sent.reason === "error") return { ok: false, reason: "email_failed" };
  return { ok: true, email, id: row!.id };
}

/**
 * The request starts what it asked for at once: the account for this address (made
 * if needed, its address not yet proven, so no sign-in), the item saved, and Trilio's
 * offers on where the text covered them and the person never answered that question.
 * A switch the person turned off before stays off: the receipt says how to turn it on.
 */
export async function activateRequest(
  db: Db,
  request: NotifyRequest,
  save: (userId: string, request: NotifyRequest) => Promise<boolean>,
  now = new Date(),
): Promise<{ userId: string; alertsOff: boolean } | null> {
  const offers = request.offers ? { offersOptIn: true, offersOptInAt: now, offersAskedAt: now } : {};
  let [user] = await db
    .select({ id: users.id, priceAlerts: users.priceAlerts, offersAskedAt: users.offersAskedAt })
    .from(users)
    .where(eq(users.email, request.email));
  let created = false;
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email: request.email, locale: request.locale, ...offers })
      .onConflictDoNothing()
      .returning({ id: users.id, priceAlerts: users.priceAlerts, offersAskedAt: users.offersAskedAt });
    created = !!user;
    if (!user)
      [user] = await db
        .select({ id: users.id, priceAlerts: users.priceAlerts, offersAskedAt: users.offersAskedAt })
        .from(users)
        .where(eq(users.email, request.email));
  } else if (request.offers && !user.offersAskedAt) {
    await db.update(users).set(offers).where(eq(users.id, user.id));
  }
  if (!user) return null;
  if (!(await save(user.id, request))) {
    // Nothing was saved (the product is gone): leave no empty account behind.
    if (created) await db.delete(users).where(eq(users.id, user.id));
    return null;
  }
  await db
    .update(notifyRequests)
    .set({ userId: user.id, activatedAt: now })
    .where(eq(notifyRequests.id, request.id));
  return { userId: user.id, alertsOff: !user.priceAlerts };
}

export async function requestByToken(db: Db, value: string): Promise<NotifyRequest | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return null;
  const [row] = await db.select().from(notifyRequests).where(eq(notifyRequests.token, value));
  return row ?? null;
}

/**
 * The click on the e-mailed link: the account (made if needed, its address now
 * proven), the item saved by the caller's `save`, price e-mails on, and Trilio's
 * offers on only when the consent text shown covered them. Idempotent.
 */
export async function confirmNotify(
  db: Db,
  value: string,
  save: (userId: string, request: NotifyRequest) => Promise<boolean>,
  now = new Date(),
): Promise<{ ok: true; request: NotifyRequest; userId: string } | { ok: false }> {
  const request = await requestByToken(db, value);
  if (!request || !requestState(request, now).confirmable) return { ok: false };
  if (request.confirmedAt && request.userId) return { ok: true, request, userId: request.userId };
  let [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, request.email));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email: request.email, emailVerified: now, locale: request.locale })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (!user) [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, request.email));
  }
  const userId = user!.id;
  if (!(await save(userId, request))) return { ok: false };
  await db
    .update(users)
    .set({
      priceAlerts: true,
      // The click on the e-mailed link proves the address.
      emailVerified: sql`coalesce(${users.emailVerified}, ${now.toISOString()}::timestamptz)`,
      ...(request.offers ? { offersOptIn: true, offersOptInAt: now, offersAskedAt: now } : {}),
    })
    .where(eq(users.id, userId));
  const [updated] = await db
    .update(notifyRequests)
    .set({ confirmedAt: now, userId })
    .where(eq(notifyRequests.id, request.id))
    .returning();
  // A proposal already sent to this request's address now belongs to the account (docs/REQUEST_OFFER_PLAN.md).
  await db
    .update(specialOffers)
    .set({ userId })
    .where(and(eq(specialOffers.notifyRequestId, request.id), isNull(specialOffers.userId)));
  return { ok: true, request: updated!, userId };
}

/** Auth.js "notify" provider: a just-confirmed link signs its account in, once. */
export async function notifySignIn(
  db: Db,
  value: string,
  now = new Date(),
): Promise<{ id: string; email: string; name: string | null } | null> {
  const request = await requestByToken(db, value);
  if (!request?.userId || !requestState(request, now).canSignIn) return null;
  const rows = await db
    .update(notifyRequests)
    .set({ signedInAt: now })
    .where(and(eq(notifyRequests.id, request.id)))
    .returning({ id: notifyRequests.id });
  if (!rows.length) return null;
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, request.userId));
  return user ?? null;
}

/**
 * Housekeeping: requests that started nothing (an older text, never confirmed) go after
 * 7 days, as the privacy policy says. A request that started the price e-mails is the
 * record of that consent: it goes with its account (docs/ALERTS_WITHOUT_CONFIRM_PLAN.md).
 */
export async function purgeNotifyRequests(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REQUEST_TTL_MS);
  const rows = await db
    .delete(notifyRequests)
    .where(
      and(
        isNull(notifyRequests.confirmedAt),
        isNull(notifyRequests.activatedAt),
        lt(notifyRequests.createdAt, cutoff),
      ),
    )
    .returning({ id: notifyRequests.id });
  return rows.length;
}
