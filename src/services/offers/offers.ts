import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  notifyRequests,
  offerEvents,
  products,
  savedItems,
  specialOffers,
  users,
  type ManualProduct,
  type OfferComparison,
  type SpecialOffer,
} from "@/db/schema";
import { requestOfferable, type OfferableReason } from "@/domain/notify/notify";
import { IMAGE_HOSTS } from "@/db/stores";
import { imageSrc } from "@/domain/catalog/media";
import { canAccept } from "@/domain/offers/offers";
import type { EmailMessage, EmailSender } from "@/services/notify/email";
import { offersPaused } from "@/services/admin/audit";
import { referenceFor } from "./reference";
import { composeOfferEmail, type AlternativeMail, type OfferMailContext } from "./compose";
import { comparisonWords } from "./alternative";
import { imagePath, imagesOfSet } from "./images";
import { localizedPath, type UiLocale } from "@/i18n/routing";

// Personal offers (docs/ADMIN_AND_OFFERS_PLAN.md §3–§5): made by the admin,
// one per person per product, sent only to people who opted in, and claims
// frozen at the moment the offer was made.

export const token = () => randomBytes(32).toString("base64url");

export type OfferInput = {
  productId: string;
  userIds: string[];
  /**
   * "Iegūt lētāk" requests whose address is not confirmed: one proposal each, to the
   * address entered (docs/REQUEST_OFFER_PLAN.md). Only requests requestOfferable allows.
   */
  requestIds?: string[];
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
  /** The admin's own description ("Trilio apraksts"). */
  description?: string | null;
  /** Pictures the admin added (offer_images.set_id). */
  imageSetId?: string | null;
  /**
   * Another maker's product in place of the one asked for (docs/ALTERNATIVE_OFFER_PLAN.md):
   * the requests and savers are of that product, and the comparison is frozen on the offer.
   */
  alternativeTo?: { productId: string; name: string; comparison: OfferComparison } | null;
  /** A product no partner shop lists, typed by the admin (productId is then the original's, unused). */
  manualProduct?: ManualProduct | null;
};

export type SkipReason =
  "no_consent" | "unknown" | "other_product" | "offered" | Exclude<OfferableReason, "ok">;

export type CreatedOffer = { offerId: string; userId: string | null; notifyRequestId: string | null };

export type CreateResult =
  | {
      ok: true;
      offerIds: string[];
      created: CreatedOffer[];
      skipped: { userId: string; reason: SkipReason }[];
    }
  | { ok: false; reason: "product" | "price" | "recipients" | "validity" };

/**
 * Which of these requests may get a proposal for this product now, and why not the
 * rest: requestOfferable, the same product, and no proposal for the request yet.
 */
export async function offerableRequests(db: Db, requestIds: string[], productId: string, now = new Date()) {
  const ids = [...new Set(requestIds)];
  if (ids.length === 0) return { ok: [] as (typeof notifyRequests.$inferSelect)[], skipped: [] };
  const rows = await db.select().from(notifyRequests).where(inArray(notifyRequests.id, ids));
  const offered = await db
    .select({ id: specialOffers.notifyRequestId })
    .from(specialOffers)
    .where(and(inArray(specialOffers.notifyRequestId, ids), sql`${specialOffers.status} <> 'cancelled'`));
  const taken = new Set(offered.map((o) => o.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ok: (typeof notifyRequests.$inferSelect)[] = [];
  const skipped: { userId: string; reason: SkipReason }[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) {
      skipped.push({ userId: id, reason: "unknown" });
      continue;
    }
    const why = requestOfferable(r, now);
    if (why !== "ok") skipped.push({ userId: id, reason: why });
    else if (r.productId !== productId) skipped.push({ userId: id, reason: "other_product" });
    else if (taken.has(r.id)) skipped.push({ userId: id, reason: "offered" });
    else ok.push(r);
  }
  return { ok, skipped };
}

/** Drafts, one per recipient who opted in. Recipients without consent are skipped and reported. */
export async function createOffers(db: Db, input: OfferInput, createdBy: string): Promise<CreateResult> {
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) return { ok: false, reason: "price" };
  if (input.validUntil.getTime() <= Date.now()) return { ok: false, reason: "validity" };
  if (input.userIds.length === 0 && !input.requestIds?.length) return { ok: false, reason: "recipients" };
  const manual = input.manualProduct ?? null;
  const ref = manual ? null : await referenceFor(db, input.productId);
  if (!ref && !manual) return { ok: false, reason: "product" };
  if (manual && !input.alternativeTo) return { ok: false, reason: "product" };
  // An alternative answers the requests of the product asked for.
  const askedFor = input.alternativeTo?.productId ?? ref!.product.id;

  const people = await db
    .select({ id: users.id, optIn: users.offersOptIn })
    .from(users)
    .where(inArray(users.id, input.userIds));
  const known = new Map(people.map((p) => [p.id, p.optIn]));
  const skipped: { userId: string; reason: SkipReason }[] = [];
  const recipients: string[] = [];
  for (const id of new Set(input.userIds)) {
    if (!known.has(id)) skipped.push({ userId: id, reason: "unknown" });
    else if (!known.get(id)) skipped.push({ userId: id, reason: "no_consent" });
    else recipients.push(id);
  }
  // Requests whose address is not confirmed: one proposal each, to the address entered.
  const requests = await offerableRequests(db, input.requestIds ?? [], askedFor);
  skipped.push(...requests.skipped);
  const targets: { userId: string | null; email: string | null; notifyRequestId: string | null }[] = [
    ...recipients.map((userId) => ({ userId, email: null, notifyRequestId: null })),
    ...requests.ok.map((r) => ({ userId: null, email: r.email, notifyRequestId: r.id })),
  ];
  if (targets.length === 0) return { ok: true, offerIds: [], created: [], skipped };
  const subcategoryId =
    ref?.product.subcategoryId ?? (await referenceFor(db, askedFor))?.product.subcategoryId ?? "";

  const batchId = targets.length > 1 ? randomUUID() : null;
  const rows = await db
    .insert(specialOffers)
    .values(
      targets.map((target) => ({
        token: token(),
        ...target,
        productId: ref?.product.id ?? null,
        productName: ref?.product.name ?? manual!.name,
        subcategoryId,
        condition: input.condition,
        grade: input.condition === "refurbished" ? input.grade : null,
        warrantyMonths: input.warrantyMonths,
        priceCents: input.priceCents,
        referencePriceCents: ref?.priceCents ?? null,
        referenceLow30Cents: ref?.low30Cents ?? null,
        referenceStoreName: ref?.storeName ?? null,
        alternativeToProductId: input.alternativeTo?.productId ?? null,
        alternativeToName: input.alternativeTo?.name ?? null,
        comparison: input.alternativeTo?.comparison ?? null,
        description: input.description?.trim().slice(0, 1500) || null,
        imageSetId: input.imageSetId ?? null,
        manualProduct: manual,
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
    .returning({
      id: specialOffers.id,
      userId: specialOffers.userId,
      notifyRequestId: specialOffers.notifyRequestId,
    });
  await db
    .insert(offerEvents)
    .values(rows.map((r) => ({ offerId: r.id, kind: "created", source: "admin", note: createdBy })));
  return {
    ok: true,
    offerIds: rows.map((r) => r.id),
    created: rows.map((r) => ({ offerId: r.id, userId: r.userId, notifyRequestId: r.notifyRequestId })),
    skipped,
  };
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

/**
 * The offer as the e-mail shows it: the admin's pictures or the product's (when the
 * shop allows it), the description, and for another maker's product the comparison
 * in the reader's words, when the request was made and how long the price is followed.
 */
export async function mailDraft(
  db: Db,
  offer: SpecialOffer,
  ctx: { lang: UiLocale; baseUrl: string; userId: string | null },
) {
  let imageUrl: string | null = null;
  if (offer.productId) {
    const [row] = await db
      .select({ imageUrl: products.imageUrl })
      .from(products)
      .where(eq(products.id, offer.productId));
    imageUrl = imageSrc(row?.imageUrl, IMAGE_HOSTS);
  }
  const imageUrls = (await imagesOfSet(db, offer.imageSetId)).map((i) => imagePath(i.id));
  let alternative: AlternativeMail | null = null;
  if (offer.alternativeToName && offer.comparison) {
    const asked = offer.alternativeToProductId;
    const [request] = asked
      ? await db
          .select({ at: notifyRequests.createdAt })
          .from(notifyRequests)
          .where(
            and(
              eq(notifyRequests.productId, asked),
              offer.notifyRequestId
                ? eq(notifyRequests.id, offer.notifyRequestId)
                : ctx.userId
                  ? eq(notifyRequests.userId, ctx.userId)
                  : sql`false`,
            ),
          )
          .orderBy(desc(notifyRequests.createdAt))
          .limit(1)
      : [];
    const [saved] =
      asked && ctx.userId
        ? await db
            .select({ until: savedItems.alertsUntil })
            .from(savedItems)
            .where(and(eq(savedItems.userId, ctx.userId), eq(savedItems.productId, asked)))
        : [];
    alternative = {
      askedName: offer.alternativeToName,
      equivalent: offer.comparison.label === "equivalent",
      ...comparisonWords(offer.comparison, offer.subcategoryId, ctx.lang),
      originalSeenCents: offer.comparison.originalSeenCents,
      requestedAt: request?.at ?? null,
      declineUrl: `${ctx.baseUrl}${localizedPath(`/piedavajums/${offer.token}/atteikt`, ctx.lang)}`,
      watchUntil: saved?.until ?? null,
    };
  }
  return { ...offer, imageUrl, imageUrls, alternative };
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
 * Who an offer goes to and how the e-mail closes: an account (with its consent and
 * unsubscribe link), or an "Iegūt lētāk" request whose address is not confirmed
 * (docs/REQUEST_OFFER_PLAN.md: one proposal, the reason it came, a link that
 * confirms the address, and an unsubscribe that deletes the request). A request
 * confirmed since hands its offer to the new account. Null with the reason it cannot go.
 */
async function recipientOf(
  db: Db,
  offer: SpecialOffer,
  baseUrl: string,
  now: Date,
): Promise<
  | {
      ok: true;
      to: string;
      lang: "lv" | "en";
      unsubscribeUrl?: string;
      request?: { at: Date; followUrl: string };
      userId: string | null;
    }
  | { ok: false; reason: "no_consent" | "expired" }
> {
  let userId = offer.userId;
  if (!userId && offer.notifyRequestId) {
    const [request] = await db
      .select()
      .from(notifyRequests)
      .where(eq(notifyRequests.id, offer.notifyRequestId));
    if (!request) return { ok: false, reason: "expired" };
    if (request.userId) {
      userId = request.userId;
      await db.update(specialOffers).set({ userId }).where(eq(specialOffers.id, offer.id));
    } else {
      if (requestOfferable(request, now) !== "ok") return { ok: false, reason: "expired" };
      const lang = request.locale === "en" ? "en" : "lv";
      return {
        ok: true,
        to: offer.email ?? request.email,
        lang,
        request: {
          at: request.createdAt,
          followUrl: `${baseUrl}${localizedPath(`/pazinot/${request.token}`, lang)}`,
        },
        // The lawyer (9 Nov 2026): typing the address is consent enough, but it must be easy to stop.
        unsubscribeUrl: `${baseUrl}${localizedPath(`/piedavajumi/atteikties/${request.token}`, lang)}`,
        userId: null,
      };
    }
  }
  if (!userId) return { ok: false, reason: "no_consent" };
  const [user] = await db
    .select({ email: users.email, optIn: users.offersOptIn, locale: users.locale })
    .from(users)
    .where(eq(users.id, userId));
  if (!user?.optIn) return { ok: false, reason: "no_consent" };
  const unsub = await ensureOffersToken(db, userId);
  const lang = user.locale === "en" ? "en" : "lv";
  return {
    ok: true,
    to: user.email,
    lang,
    unsubscribeUrl: `${baseUrl}${localizedPath(`/piedavajumi/atteikties/${unsub}`, lang)}`,
    userId,
  };
}

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
  if (!offer || offer.status !== "draft" || (!offer.userId && !offer.notifyRequestId))
    return { ok: false, reason: "not_draft" };
  if (offer.validUntil.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (await offersPaused(db)) return { ok: false, reason: "paused" };
  const to = await recipientOf(db, offer, deps.baseUrl, now);
  if (!to.ok) return to;
  const message = composeOfferEmail(
    await mailDraft(db, offer, { lang: to.lang, baseUrl: deps.baseUrl, userId: to.userId }),
    {
      ...deps,
      to: to.to,
      lang: to.lang,
      unsubscribeUrl: to.unsubscribeUrl,
      request: to.request,
      saved: to.userId ? await savedContext(db, { ...offer, userId: to.userId }) : null,
      now,
    },
  );
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
  if (!offer?.userId && !offer?.notifyRequestId) return null;
  if (!offer.userId) {
    // A proposal answering an unconfirmed request, as it would go out (or "…" once the request is gone).
    const [request] = await db
      .select()
      .from(notifyRequests)
      .where(eq(notifyRequests.id, offer.notifyRequestId!));
    const lang = request?.locale === "en" ? "en" : "lv";
    return composeOfferEmail(await mailDraft(db, offer, { lang, baseUrl: ctx.baseUrl, userId: null }), {
      ...ctx,
      to: offer.email ?? "",
      lang,
      request: {
        at: request?.createdAt ?? offer.createdAt,
        followUrl: `${ctx.baseUrl}${localizedPath(`/pazinot/${request?.token ?? "…"}`, lang)}`,
      },
      unsubscribeUrl: `${ctx.baseUrl}${localizedPath("/piedavajumi/atteikties/…", lang)}`,
      saved: null,
      now: ctx.now ?? new Date(),
    });
  }
  const [user] = await db
    .select({ email: users.email, locale: users.locale })
    .from(users)
    .where(eq(users.id, offer.userId));
  const lang = user?.locale === "en" ? "en" : "lv";
  return composeOfferEmail(await mailDraft(db, offer, { lang, baseUrl: ctx.baseUrl, userId: offer.userId }), {
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
  const found = await offerByToken(db, value);
  if (!found || !canAccept(found, now)) return null;
  if (await offerSignInUsed(db, found.id)) return null;
  // A proposal sent to an unconfirmed request's address (docs/REQUEST_OFFER_PLAN.md): the link
  // came to that inbox, so it proves the address as a magic link does. The account is found or
  // made for it and the offer attached; Trilio's other offers stay off until the person says yes.
  const offer = found.userId ? found : await attachOfferAccount(db, found, now);
  if (!offer?.userId) return null;
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, offer.userId));
  if (!user) return null;
  await db.insert(offerEvents).values({ offerId: offer.id, kind: "signin", source: "buyer" });
  return user;
}

/** The account for an account-less offer's address, found or made, with the offer attached. */
async function attachOfferAccount(db: Db, offer: SpecialOffer, now: Date): Promise<SpecialOffer | null> {
  const email = offer.email?.trim().toLowerCase();
  if (!email || !offer.notifyRequestId || offer.status === "draft") return null;
  let [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email, emailVerified: now })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (!user) [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  }
  if (!user) return null;
  const [attached] = await db
    .update(specialOffers)
    .set({ userId: user.id })
    .where(and(eq(specialOffers.id, offer.id), isNull(specialOffers.userId)))
    .returning();
  return attached ?? (await offerById(db, offer.id));
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
    // Either way the person has answered, so the one-tap question is not asked again.
    .set({ offersOptIn: optIn, offersOptInAt: optIn ? new Date() : null, offersAskedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function offersOptIn(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ v: users.offersOptIn }).from(users).where(eq(users.id, userId));
  return row?.v ?? false;
}

/** Whose link this is: an account's offers token, or an unconfirmed "Iegūt lētāk" request's. */
export async function unsubscribeKind(db: Db, value: string): Promise<"account" | "request" | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return null;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.offersToken, value));
  if (user) return "account";
  const [request] = await db
    .select({ id: notifyRequests.id })
    .from(notifyRequests)
    .where(and(eq(notifyRequests.token, value), isNull(notifyRequests.confirmedAt)));
  return request ? "request" : null;
}

/**
 * One-click unsubscribe from an e-mail; needs no sign-in. Open offers to that person are cancelled.
 * For a proposal to an unconfirmed request the link carries the request's token: the request is
 * deleted, so nothing more goes to that address and its confirmation link stops working.
 */
export async function unsubscribeByToken(db: Db, value: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return false;
  const rows = await db
    .update(users)
    .set({ offersOptIn: false, offersOptInAt: null })
    .where(eq(users.offersToken, value))
    .returning({ id: users.id });
  const userId = rows[0]?.id;
  if (!userId) return unsubscribeRequest(db, value);
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

async function unsubscribeRequest(db: Db, value: string): Promise<boolean> {
  const [request] = await db
    .select({ id: notifyRequests.id })
    .from(notifyRequests)
    .where(and(eq(notifyRequests.token, value), isNull(notifyRequests.confirmedAt)));
  if (!request) return false;
  const open = await db
    .update(specialOffers)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(specialOffers.notifyRequestId, request.id),
        isNull(specialOffers.userId),
        inArray(specialOffers.status, ["draft", "sent", "opened"]),
      ),
    )
    .returning({ id: specialOffers.id });
  if (open.length)
    await db
      .insert(offerEvents)
      .values(open.map((o) => ({ offerId: o.id, kind: "cancelled", source: "buyer", note: "unsubscribed" })));
  await db.delete(notifyRequests).where(eq(notifyRequests.id, request.id));
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

/** The owner's note on an offer, in its timeline. */
export async function addOfferNote(db: Db, offerId: string, note: string, by: string): Promise<boolean> {
  const text = note.trim().slice(0, 1000);
  const offer = await offerById(db, offerId);
  if (!offer || !text) return false;
  await db.insert(offerEvents).values({ offerId, kind: "note", source: "admin", note: text, data: { by } });
  return true;
}
