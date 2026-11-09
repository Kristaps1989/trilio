"use server";

import { saveRequestItem } from "../pazinot/save-request";
import { and, eq, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth, currentUserId, enabledProviders, signIn } from "@/auth";
import { isAdminEmail } from "@/config/admin";
import { db, savedItems, users } from "@/db";
import { adLandingFor } from "@/services/growth/landings";
import { removeSaved } from "@/db/queries/wishlist";
import { setOffersOptIn } from "@/services/offers/offers";
import { priceAlertsOn, setPriceAlerts } from "@/services/wishlist/alerts";
import { getLocale } from "next-intl/server";
import { loadProduct } from "@/db/queries/catalog";
import { IMAGE_HOSTS } from "@/db/stores";
import { imageSrc } from "@/domain/catalog/media";
import { trilioSources } from "@/domain/offers/sourcing";
import { getSubcategory } from "@/domain/questions/catalog";
import { currentOffer } from "@/domain/wishlist/wishlist";
import { isUiLocale } from "@/i18n/routing";
import { recordUiEvent, visitorOf } from "@/services/notify/events";
import { judgeRequest } from "@/services/visits/judge";
import { requestNotify, type NotifyTarget } from "@/services/notify/requests";
import { offerMailDeps } from "@/services/offers/deps";
import { metaPixelId } from "@/config/analytics";
import { capiConfigFromEnv, newEventId, sendCapiEvent } from "@/services/meta/capi";
import { CONSENT_COOKIE } from "@/ui/analytics/consent";
import { keyOf, saveTarget, type SaveTarget } from "./save";
import { withPending } from "@/ui/pendingRequest";

// "Iegūt lētāk" and the e-mail settings. Every action checks the session and
// writes only the signed-in user's rows.

const Target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("product"), productId: z.string().uuid() }),
  z.object({
    kind: z.literal("search"),
    subcategoryId: z.string().min(1).max(40),
    answersParam: z.string().max(4000),
    label: z.string().min(1).max(300),
  }),
]);

/** A save made the same day as an ad visit counts for that ad (docs/GROWTH_PLAN.md, Phase 0). */
async function creditAdLanding(userId: string, key: string): Promise<void> {
  const id = await adLandingFor(db, await who());
  if (!id) return;
  await db
    .update(savedItems)
    .set({ adLandingId: id })
    .where(and(eq(savedItems.userId, userId), eq(savedItems.key, key), isNull(savedItems.adLandingId)));
}

/**
 * A better-price request is Meta's `Lead` (docs/META_ADS_PLAN.md §2): only
 * when the Pixel is on and the visitor accepted cookies. Returns the event id
 * the browser Pixel sends too, so Meta counts it once; the server copy goes
 * after the response, with the e-mail hashed.
 */
async function metaLead(
  email: string,
  subcategoryId: string,
  returnPath: string | null,
): Promise<string | undefined> {
  if (!metaPixelId()) return undefined;
  const jar = await cookies();
  if (jar.get(CONSENT_COOKIE)?.value !== "granted") return undefined;
  const eventId = newEventId();
  const h = await headers();
  const w = await who();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? ""}`;
  const referer = h.get("referer");
  const page = returnPath ? new URL(returnPath, origin) : referer ? new URL(referer) : new URL(origin);
  const event = {
    name: "Lead" as const,
    eventId,
    url: `${page.origin}${page.pathname}`,
    ip: w.ip,
    userAgent: w.userAgent,
    email,
    fbp: jar.get("_fbp")?.value ?? null,
    fbc: jar.get("_fbc")?.value ?? null,
    category: subcategoryId,
  };
  after(() => sendCapiEvent(capiConfigFromEnv(), event));
  return eventId;
}

async function who() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return { ip, userAgent: h.get("user-agent"), suspect: await judgeRequest(h).catch(() => null) };
}

/** The subcategory a target belongs to (a product's own, or the search's). */
async function subcategoryOf(target: SaveTarget): Promise<string | null> {
  if (target.kind === "search") return target.subcategoryId;
  const product = await loadProduct(db, target.productId);
  return product?.subcategoryId ?? null;
}

export type ToggleResult =
  /** `lead`: the Meta event id when this save was a better-price request (consent given). */
  | { ok: true; saved: boolean; alerts: boolean; email: string | null; lead?: string }
  | { ok: false; reason: "auth" | "invalid" }
  /** Signed in, in a category where Trilio sources: the one yes is asked once, with the text it covers. */
  | { ok: false; reason: "consent"; email: string };

/**
 * "Iegūt lētāk" (docs/PRICE_NOTIFY_PLAN.md): saves the item
 * and turns price e-mails on. Signed out, the card opens the e-mail field
 * instead. Signed in where Trilio sources, the first tap shows the one
 * sentence that also covers Trilio's offers; `consent` is that sentence's yes.
 */
export async function toggleSavedAction(
  raw: SaveTarget,
  save: boolean,
  consent = false,
): Promise<ToggleResult> {
  const target = Target.safeParse(raw);
  if (!target.success) return { ok: false, reason: "invalid" };
  const sub = save ? await subcategoryOf(target.data) : null;
  if (save) await recordUiEvent(db, await who(), "notify_tap", sub).catch(() => undefined);
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: "auth" };
  const [user] = await db
    .select({ email: users.email, optIn: users.offersOptIn, asked: users.offersAskedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return { ok: false, reason: "auth" };
  if (save) {
    // Only a product is a request to a partner; a saved search is a watch and asks nothing.
    // Pressing "Iegūt lētāk" is asking for a lower price (owner, 9 Nov 2026): whoever has offers off
    // sees the one sentence again, even after an earlier "no", and its yes turns them on.
    const ask = target.data.kind === "product" && !!sub && trilioSources(sub) && !user.optIn;
    if (ask && !consent) return { ok: false, reason: "consent", email: user.email };
    if (!(await saveTarget(userId, target.data))) return { ok: false, reason: "invalid" };
    await creditAdLanding(userId, keyOf(target.data)).catch(() => undefined);
    if (ask && consent) {
      const now = new Date();
      await db
        .update(users)
        .set({ offersOptIn: true, offersOptInAt: now, offersAskedAt: now, priceAlerts: true })
        .where(eq(users.id, userId));
    }
  } else {
    await removeSaved(db, userId, keyOf(target.data));
  }
  revalidatePath("/velmju-saraksts");
  const alerts = save ? await priceAlertsOn(db, userId) : false;
  const request = save && target.data.kind === "product" && !!sub && trilioSources(sub);
  const lead = request ? await metaLead(user.email, sub, null).catch(() => undefined) : undefined;
  return { ok: true, saved: save, alerts, email: user.email, ...(lead ? { lead } : {}) };
}

export type NotifyRequestResult =
  | { ok: true; email: string; lead?: string }
  | { ok: false; reason: "invalid" | "too_many" | "email_failed" | "unknown" };

/** The question before the shop was shown for this item (docs/PRICE_NOTIFY_PLAN.md §8.4); people only, no cookie. */
export async function askShownAction(raw: SaveTarget): Promise<void> {
  const target = Target.safeParse(raw);
  if (!target.success) return;
  // The owner's own look at the question is not a shopper's.
  if (isAdminEmail((await auth().catch(() => null))?.user?.email ?? "")) return;
  const sub = await subcategoryOf(target.data);
  await recordUiEvent(db, await who(), "ask_shown", sub).catch(() => undefined);
}

/** The e-mail field on a card, signed out: one confirmation e-mail, nothing else until it is clicked. */
export async function requestNotifyAction(
  raw: SaveTarget,
  email: string,
  returnPath: string,
): Promise<NotifyRequestResult> {
  const parsed = Target.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "unknown" };
  const t = parsed.data;
  let target: NotifyTarget;
  if (t.kind === "product") {
    const product = await loadProduct(db, t.productId);
    if (!product) return { ok: false, reason: "unknown" };
    target = {
      kind: "product",
      productId: product.id,
      subcategoryId: product.subcategoryId,
      name: product.name,
      priceCents: currentOffer(product)?.priceCents ?? null,
      imageUrl: imageSrc(product.imageUrl, IMAGE_HOSTS),
    };
  } else {
    if (!getSubcategory(t.subcategoryId, "lv")) return { ok: false, reason: "unknown" };
    target = t;
  }
  const w = await who();
  const visitor = await visitorOf(db, w).catch(() => null);
  const locale = await getLocale();
  const deps = offerMailDeps();
  const r = await requestNotify(
    db,
    {
      email,
      target,
      returnPath,
      locale: isUiLocale(locale) ? locale : "lv",
      visitorHash: visitor?.hash ?? null,
      adLandingId: visitor?.adLandingId ?? null,
    },
    { email: deps.email, baseUrl: deps.baseUrl, company: deps.company, save: saveRequestItem },
  );
  if (!r.ok) return r;
  await recordUiEvent(db, w, "notify_sent", target.subcategoryId).catch(() => undefined);
  const lead =
    target.kind === "product" && trilioSources(target.subcategoryId)
      ? await metaLead(r.email, target.subcategoryId, returnPath).catch(() => undefined)
      : undefined;
  return { ok: true, email: r.email, ...(lead ? { lead } : {}) };
}

/** Price-drop e-mails on or off: the "Nesūtīt" under the heart and the switch in the account. */
export async function setPriceAlertsAction(on: boolean): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId || typeof on !== "boolean") return false;
  await setPriceAlerts(db, userId, on);
  revalidatePath("/velmju-saraksts");
  revalidatePath("/konts");
  return true;
}

/**
 * Whether to ask the one-tap offers question (owner, 9 Nov 2026): signed in, offers off, and
 * never answered. Read by the client so pages stay cacheable.
 */
export async function offersAskStateAction(): Promise<{ ask: boolean }> {
  const userId = await currentUserId();
  if (!userId) return { ask: false };
  const [user] = await db
    .select({ optIn: users.offersOptIn, asked: users.offersAskedAt })
    .from(users)
    .where(eq(users.id, userId));
  return { ask: !!user && !user.optIn && !user.asked };
}

/** The answer to that question: "Jā" turns offers on; either answer means it is not asked again. */
export async function answerOffersAskAction(yes: boolean): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId || typeof yes !== "boolean") return false;
  await setOffersOptIn(db, userId, yes);
  revalidatePath("/velmju-saraksts");
  revalidatePath("/konts");
  return true;
}

/** The personal-offers consent: a "Jā" the shopper taps or a box they tick (never pre-ticked), withdrawn the same way. */
export async function setOffersOptInAction(optIn: boolean): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId || typeof optIn !== "boolean") return false;
  await setOffersOptIn(db, userId, optIn);
  revalidatePath("/velmju-saraksts");
  revalidatePath("/konts");
  return true;
}

// "Turpināt ar Google" in the e-mail step (docs/PRICE_NOTIFY_PLAN.md §8.6): the
// product waits in a short-lived httpOnly cookie while the shopper signs in, so
// only this browser's own click can finish it; a link from elsewhere cannot.
const PENDING_COOKIE = "trilio_pending_request";
const PENDING_SECONDS = 15 * 60;

/** Signed out, "Turpināt ar Google": remember the product, then off to Google (the dev login in tests). */
export async function requestWithGoogleAction(
  raw: SaveTarget,
  returnPath: string,
): Promise<{ ok: false } | { ok: true; go: string } | undefined> {
  const target = Target.safeParse(raw);
  if (!target.success || target.data.kind !== "product") return { ok: false };
  const back = returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/";
  (await cookies()).set(PENDING_COOKIE, target.data.productId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PENDING_SECONDS,
  });
  const redirectTo = withPending(back);
  // Google leaves the site and comes back with a full page load; the test login does the same through `go`.
  if (enabledProviders.google) await signIn("google", { redirectTo });
  if (enabledProviders.dev) {
    await signIn("dev", { email: GOOGLE_TEST_EMAIL, redirect: false });
    return { ok: true, go: redirectTo };
  }
  return { ok: false };
}

/** The e-mail a test "Google" sign-in uses where Google is not configured (dev login only). */
const GOOGLE_TEST_EMAIL = "google-e2e@example.invalid";

export type PendingResult =
  { ok: true; productId: string; email: string; alerts: boolean; lead?: string } | { ok: false };

/**
 * Back from Google: the request the shopper asked for, with the consent they gave
 * on the card (the same sentence as the e-mail field). Needs this browser's
 * cookie and a signed-in session; the cookie is used once.
 */
export async function completePendingRequestAction(): Promise<PendingResult> {
  const jar = await cookies();
  const productId = jar.get(PENDING_COOKIE)?.value;
  if (!productId || !z.string().uuid().safeParse(productId).success) return { ok: false };
  if (!(await currentUserId())) return { ok: false };
  jar.delete(PENDING_COOKIE);
  const target: SaveTarget = { kind: "product", productId };
  const r = await toggleSavedAction(target, true, true);
  if (!r.ok || !r.email) return { ok: false };
  const sub = await subcategoryOf(target);
  // The e-mail is confirmed by Google: the funnel's "entered" and "confirmed" both happen here.
  const w = await who();
  await recordUiEvent(db, w, "notify_sent", sub).catch(() => undefined);
  await recordUiEvent(db, w, "notify_confirmed", sub).catch(() => undefined);
  return { ok: true, productId, email: r.email, alerts: r.alerts, ...(r.lead ? { lead: r.lead } : {}) };
}
