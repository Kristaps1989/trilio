import { and, count, eq, gte, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { notifyRequests, users, type NotifyRequest } from "@/db/schema";
import {
  REQUEST_TTL_MS,
  consentFor,
  normaliseEmail,
  rateLimit,
  requestState,
  safeReturnPath,
  type NotifyKind,
} from "@/domain/notify/notify";
import { trilioSources, type Sourcing } from "@/domain/offers/sourcing";
import type { EmailSender } from "@/services/notify/email";
import { token } from "@/services/offers/offers";
import type { UiLocale } from "@/i18n/routing";
import { composeNotifyConfirmEmail } from "./confirm-email";

// Double opt-in for price e-mails without an account (docs/PRICE_NOTIFY_PLAN.md
// §2, §5 PR 2). The request holds what was asked and the consent text shown;
// the e-mailed link confirms it, creates the account if needed, saves the
// item and turns the e-mails on. Nothing is sent to the address before that.

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
  const consent = consentFor(t.kind as NotifyKind, trilioSources(t.subcategoryId, deps.sourcing));
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
  const sent = await deps.email.send(
    composeNotifyConfirmEmail({
      to: email,
      lang: input.locale,
      baseUrl: deps.baseUrl,
      company: deps.company,
      token: value,
      target: t,
    }),
  );
  if (!sent.ok && sent.reason === "error") {
    await db.delete(notifyRequests).where(eq(notifyRequests.id, row!.id));
    return { ok: false, reason: "email_failed" };
  }
  return { ok: true, email, id: row!.id };
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
      ...(request.offers ? { offersOptIn: true, offersOptInAt: now, offersAskedAt: now } : {}),
    })
    .where(eq(users.id, userId));
  const [updated] = await db
    .update(notifyRequests)
    .set({ confirmedAt: now, userId })
    .where(eq(notifyRequests.id, request.id))
    .returning();
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

/** Housekeeping: unconfirmed requests go after 7 days (the privacy policy says so). */
export async function purgeNotifyRequests(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - REQUEST_TTL_MS);
  const rows = await db
    .delete(notifyRequests)
    .where(and(isNull(notifyRequests.confirmedAt), lt(notifyRequests.createdAt, cutoff)))
    .returning({ id: notifyRequests.id });
  return rows.length;
}
