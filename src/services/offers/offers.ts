import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { offerEvents, products, savedItems, specialOffers, users, type SpecialOffer } from "@/db/schema";
import { IMAGE_HOSTS } from "@/db/stores";
import { imageSrc } from "@/domain/catalog/media";
import { canAccept } from "@/domain/offers/offers";
import type { EmailMessage, EmailSender } from "@/services/notify/email";
import { offersPaused } from "@/services/admin/audit";
import { referenceFor } from "./reference";
import { composeOfferEmail, type OfferMailContext } from "./compose";
import { localizedPath } from "@/i18n/routing";

// Personal offers (docs/ADMIN_AND_OFFERS_PLAN.md §3–§5): made by the admin,
// one per person per product, sent only to people who opted in, and claims
// frozen at the moment the offer was made.

export const token = () => randomBytes(32).toString("base64url");

export type OfferInput = {
  productId: string;
  userIds: string[];
  priceCents: number;
  condition: "new" | "refurbished";
  grade: string | null;
  warrantyMonths: number;
  quantity: number;
  deliveryWorkingDays: number;
  validUntil: Date;
  message: string | null;
  supplierNote: string | null;
  costCents: number | null;
};

export type CreateResult =
  | { ok: true; offerIds: string[]; skipped: { userId: string; reason: "no_consent" | "unknown" }[] }
  | { ok: false; reason: "product" | "price" | "recipients" | "validity" };

/** Drafts, one per recipient who opted in. Recipients without consent are skipped and reported. */
export async function createOffers(db: Db, input: OfferInput, createdBy: string): Promise<CreateResult> {
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) return { ok: false, reason: "price" };
  if (input.validUntil.getTime() <= Date.now()) return { ok: false, reason: "validity" };
  if (input.userIds.length === 0) return { ok: false, reason: "recipients" };
  const ref = await referenceFor(db, input.productId);
  if (!ref) return { ok: false, reason: "product" };

  const people = await db
    .select({ id: users.id, optIn: users.offersOptIn })
    .from(users)
    .where(inArray(users.id, input.userIds));
  const known = new Map(people.map((p) => [p.id, p.optIn]));
  const skipped: { userId: string; reason: "no_consent" | "unknown" }[] = [];
  const recipients: string[] = [];
  for (const id of new Set(input.userIds)) {
    if (!known.has(id)) skipped.push({ userId: id, reason: "unknown" });
    else if (!known.get(id)) skipped.push({ userId: id, reason: "no_consent" });
    else recipients.push(id);
  }
  if (recipients.length === 0) return { ok: true, offerIds: [], skipped };

  const batchId = recipients.length > 1 ? randomUUID() : null;
  const rows = await db
    .insert(specialOffers)
    .values(
      recipients.map((userId) => ({
        token: token(),
        userId,
        productId: ref.product.id,
        productName: ref.product.name,
        subcategoryId: ref.product.subcategoryId,
        condition: input.condition,
        grade: input.condition === "refurbished" ? input.grade : null,
        warrantyMonths: input.warrantyMonths,
        priceCents: input.priceCents,
        referencePriceCents: ref.priceCents,
        referenceLow30Cents: ref.low30Cents,
        referenceStoreName: ref.storeName,
        quantity: input.quantity,
        deliveryWorkingDays: input.deliveryWorkingDays,
        validUntil: input.validUntil,
        message: input.message,
        supplierNote: input.supplierNote,
        costCents: input.costCents,
        batchId,
        createdBy,
      })),
    )
    .returning({ id: specialOffers.id });
  await db
    .insert(offerEvents)
    .values(rows.map((r) => ({ offerId: r.id, kind: "created", source: "admin", note: createdBy })));
  return { ok: true, offerIds: rows.map((r) => r.id), skipped };
}

export async function offerById(db: Db, id: string): Promise<SpecialOffer | null> {
  const [row] = await db.select().from(specialOffers).where(eq(specialOffers.id, id));
  return row ?? null;
}

export async function offerByToken(db: Db, value: string): Promise<SpecialOffer | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return null;
  const [row] = await db.select().from(specialOffers).where(eq(specialOffers.token, value));
  return row ?? null;
}

export type { OfferMailContext } from "./compose";

/** The unsubscribe token for offer e-mails, created on first use. */
export async function ensureOffersToken(db: Db, userId: string): Promise<string> {
  const [user] = await db.select({ t: users.offersToken }).from(users).where(eq(users.id, userId));
  if (user?.t) return user.t;
  const fresh = token();
  await db
    .update(users)
    .set({ offersToken: fresh })
    .where(and(eq(users.id, userId), isNull(users.offersToken)));
  const [again] = await db.select({ t: users.offersToken }).from(users).where(eq(users.id, userId));
  return again?.t ?? fresh;
}

/** The offer as the e-mail shows it: with the product's picture when the shop allows it. */
async function withImage(db: Db, offer: SpecialOffer) {
  if (!offer.productId) return offer;
  const [row] = await db
    .select({ imageUrl: products.imageUrl })
    .from(products)
    .where(eq(products.id, offer.productId));
  return { ...offer, imageUrl: imageSrc(row?.imageUrl, IMAGE_HOSTS) };
}

async function savedContext(db: Db, offer: SpecialOffer) {
  if (!offer.userId || !offer.productId) return null;
  const [item] = await db
    .select({ at: savedItems.createdAt, priceCents: savedItems.baselinePriceCents })
    .from(savedItems)
    .where(
      and(
        eq(savedItems.userId, offer.userId),
        eq(savedItems.kind, "product"),
        eq(savedItems.productId, offer.productId),
      ),
    );
  return item ?? null;
}

export type SendResult =
  | { ok: true; emailed: boolean }
  | { ok: false; reason: "not_draft" | "no_consent" | "paused" | "expired" | "email_failed" };

/**
 * Sends a draft. Without an e-mail service (development) the offer still
 * counts as sent and the admin copies the link; a failed send keeps the draft.
 */
export async function sendOffer(
  db: Db,
  offerId: string,
  deps: OfferMailContext & { email: EmailSender; now?: Date },
): Promise<SendResult> {
  const now = deps.now ?? new Date();
  const offer = await offerById(db, offerId);
  if (!offer || offer.status !== "draft" || !offer.userId) return { ok: false, reason: "not_draft" };
  if (offer.validUntil.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (await offersPaused(db)) return { ok: false, reason: "paused" };
  const [user] = await db
    .select({ email: users.email, optIn: users.offersOptIn, locale: users.locale })
    .from(users)
    .where(eq(users.id, offer.userId));
  if (!user?.optIn) return { ok: false, reason: "no_consent" };
  const unsub = await ensureOffersToken(db, offer.userId);
  const lang = user.locale === "en" ? "en" : "lv";
  const message = composeOfferEmail(await withImage(db, offer), {
    ...deps,
    to: user.email,
    lang,
    unsubscribeUrl: `${deps.baseUrl}${localizedPath(`/piedavajumi/atteikties/${unsub}`, lang)}`,
    saved: await savedContext(db, offer),
    now,
  });
  const sent = await deps.email.send(message);
  if (!sent.ok && sent.reason === "error") return { ok: false, reason: "email_failed" };
  await db.update(specialOffers).set({ status: "sent", sentAt: now }).where(eq(specialOffers.id, offer.id));
  await db.insert(offerEvents).values({
    offerId: offer.id,
    kind: "sent",
    source: "admin",
    data: { emailed: sent.ok },
  });
  return { ok: true, emailed: sent.ok };
}

/** The preview the admin sees before sending: exactly the e-mail that would go out. */
export async function previewOffer(
  db: Db,
  offerId: string,
  ctx: OfferMailContext & { now?: Date },
): Promise<EmailMessage | null> {
  const offer = await offerById(db, offerId);
  if (!offer?.userId) return null;
  const [user] = await db
    .select({ email: users.email, locale: users.locale })
    .from(users)
    .where(eq(users.id, offer.userId));
  const lang = user?.locale === "en" ? "en" : "lv";
  return composeOfferEmail(await withImage(db, offer), {
    ...ctx,
    to: user?.email ?? "",
    lang,
    unsubscribeUrl: `${ctx.baseUrl}${localizedPath("/piedavajumi/atteikties/…", lang)}`,
    saved: await savedContext(db, offer),
    now: ctx.now ?? new Date(),
  });
}

export async function cancelOffer(db: Db, offerId: string, by: string): Promise<boolean> {
  const rows = await db
    .update(specialOffers)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(eq(specialOffers.id, offerId), inArray(specialOffers.status, ["draft", "sent", "opened"])))
    .returning({ id: specialOffers.id });
  if (rows.length)
    await db.insert(offerEvents).values({ offerId, kind: "cancelled", source: "admin", note: by });
  return rows.length > 0;
}

/** Moves the expiry; an expired offer that nobody paid opens again. */
export async function extendOffer(db: Db, offerId: string, validUntil: Date, by: string): Promise<boolean> {
  if (validUntil.getTime() <= Date.now()) return false;
  const offer = await offerById(db, offerId);
  if (!offer || !["draft", "sent", "opened", "accepted", "expired"].includes(offer.status)) return false;
  const status = offer.status === "expired" ? (offer.openedAt ? "opened" : "sent") : offer.status;
  await db.update(specialOffers).set({ validUntil, status }).where(eq(specialOffers.id, offerId));
  await db.insert(offerEvents).values({
    offerId,
    kind: "extended",
    source: "admin",
    note: by,
    data: { validUntil: validUntil.toISOString() },
  });
  return true;
}

/** First visit of the recipient's link. Only a visit counts; e-mails carry no tracking pixel. */
export async function markOpened(db: Db, offer: SpecialOffer, now = new Date()): Promise<void> {
  if (offer.status !== "sent") return;
  const rows = await db
    .update(specialOffers)
    .set({ status: "opened", openedAt: now })
    .where(and(eq(specialOffers.id, offer.id), eq(specialOffers.status, "sent")))
    .returning({ id: specialOffers.id });
  if (rows.length)
    await db.insert(offerEvents).values({ offerId: offer.id, kind: "opened", source: "buyer" });
}

/**
 * Sign-in through the offer link (§5.3): the link was e-mailed to the
 * account's address, so while the offer is open it signs that account in,
 * once. A forwarded link that was already used asks for a normal sign-in.
 * Every such sign-in is logged.
 */
export async function offerSignIn(
  db: Db,
  value: string,
  now = new Date(),
): Promise<{ id: string; email: string; name: string | null } | null> {
  const offer = await offerByToken(db, value);
  if (!offer?.userId || !canAccept(offer, now)) return null;
  if (await offerSignInUsed(db, offer.id)) return null;
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, offer.userId));
  if (!user) return null;
  await db.insert(offerEvents).values({ offerId: offer.id, kind: "signin", source: "buyer" });
  return user;
}

export async function offerSignInUsed(db: Db, offerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: offerEvents.id })
    .from(offerEvents)
    .where(and(eq(offerEvents.offerId, offerId), eq(offerEvents.kind, "signin")))
    .limit(1);
  return !!row;
}

// ---------------------------------------------------------------- consent

export async function setOffersOptIn(db: Db, userId: string, optIn: boolean): Promise<void> {
  await db
    .update(users)
    .set({ offersOptIn: optIn, offersOptInAt: optIn ? new Date() : null })
    .where(eq(users.id, userId));
}

export async function offersOptIn(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ v: users.offersOptIn }).from(users).where(eq(users.id, userId));
  return row?.v ?? false;
}

/** One-click unsubscribe from an e-mail; needs no sign-in. Open offers to that person are cancelled. */
export async function unsubscribeByToken(db: Db, value: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return false;
  const rows = await db
    .update(users)
    .set({ offersOptIn: false, offersOptInAt: null })
    .where(eq(users.offersToken, value))
    .returning({ id: users.id });
  const userId = rows[0]?.id;
  if (!userId) return false;
  const open = await db
    .update(specialOffers)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(eq(specialOffers.userId, userId), inArray(specialOffers.status, ["draft", "sent", "opened"])))
    .returning({ id: specialOffers.id });
  if (open.length)
    await db
      .insert(offerEvents)
      .values(open.map((o) => ({ offerId: o.id, kind: "cancelled", source: "buyer", note: "unsubscribed" })));
  return true;
}

export async function offersOfUser(db: Db, userId: string) {
  return db
    .select()
    .from(specialOffers)
    .where(eq(specialOffers.userId, userId))
    .orderBy(desc(specialOffers.createdAt));
}

export async function eventsOf(db: Db, offerId: string) {
  return db
    .select()
    .from(offerEvents)
    .where(eq(offerEvents.offerId, offerId))
    .orderBy(sql`${offerEvents.createdAt} asc`);
}
