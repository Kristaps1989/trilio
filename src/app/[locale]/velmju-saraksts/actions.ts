"use server";

import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUserId } from "@/auth";
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
import { requestNotify, type NotifyTarget } from "@/services/notify/requests";
import { offerMailDeps } from "@/services/offers/deps";
import { keyOf, saveTarget, type SaveTarget } from "./save";

// "Pieprasīt labāku cenu" and the e-mail settings. Every action checks the session and
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

async function who() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return { ip, userAgent: h.get("user-agent") };
}

/** The subcategory a target belongs to (a product's own, or the search's). */
async function subcategoryOf(target: SaveTarget): Promise<string | null> {
  if (target.kind === "search") return target.subcategoryId;
  const product = await loadProduct(db, target.productId);
  return product?.subcategoryId ?? null;
}

export type ToggleResult =
  | { ok: true; saved: boolean; alerts: boolean; email: string | null }
  | { ok: false; reason: "auth" | "invalid" }
  /** Signed in, in a category where Trilio sources: the one yes is asked once, with the text it covers. */
  | { ok: false; reason: "consent"; email: string };

/**
 * "Pieprasīt labāku cenu" (docs/PRICE_NOTIFY_PLAN.md): saves the item
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
    const ask = target.data.kind === "product" && !!sub && trilioSources(sub) && !user.optIn && !user.asked;
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
  return { ok: true, saved: save, alerts, email: user.email };
}

export type NotifyRequestResult =
  { ok: true; email: string } | { ok: false; reason: "invalid" | "too_many" | "email_failed" | "unknown" };

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
    { email: deps.email, baseUrl: deps.baseUrl, company: deps.company },
  );
  if (!r.ok) return r;
  await recordUiEvent(db, w, "notify_sent", target.subcategoryId).catch(() => undefined);
  return { ok: true, email: r.email };
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

/** The personal-offers consent: a "Jā" the shopper taps or a box they tick (never pre-ticked), withdrawn the same way. */
export async function setOffersOptInAction(optIn: boolean): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId || typeof optIn !== "boolean") return false;
  await setOffersOptIn(db, userId, optIn);
  revalidatePath("/velmju-saraksts");
  revalidatePath("/konts");
  return true;
}
