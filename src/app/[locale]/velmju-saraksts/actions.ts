"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUserId } from "@/auth";
import { db, users } from "@/db";
import { cancelAtPeriodEnd, resumeSubscription, startSubscription } from "@/services/billing/engine";
import { appBaseUrl, paymentsProvider } from "@/services/payments";
import { removeSaved, setThreshold } from "@/db/queries/wishlist";
import { offersOptIn, setOffersOptIn } from "@/services/offers/offers";
import { keyOf, saveTarget, type SaveTarget } from "./save";
import { localPath } from "@/i18n/path";

// Heart toggles and the digest setting. Every action checks the session and
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

export async function toggleSavedAction(
  raw: SaveTarget,
  save: boolean,
): Promise<{ ok: true; saved: boolean; askOffers: boolean } | { ok: false; reason: "auth" | "invalid" }> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: "auth" };
  const target = Target.safeParse(raw);
  if (!target.success) return { ok: false, reason: "invalid" };
  if (save) {
    if (!(await saveTarget(userId, target.data))) return { ok: false, reason: "invalid" };
  } else {
    await removeSaved(db, userId, keyOf(target.data));
  }
  revalidatePath("/velmju-saraksts");
  // Saving a product is the moment to ask about personal offers (docs/ADMIN_AND_OFFERS_PLAN.md §11.7).
  const askOffers = save && target.data.kind === "product" && !(await offersOptIn(db, userId));
  return { ok: true, saved: save, askOffers };
}

/** The personal-offers consent: a checkbox the shopper ticks (never pre-ticked), withdrawn the same way. */
export async function setOffersOptInAction(optIn: boolean): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId || typeof optIn !== "boolean") return false;
  await setOffersOptIn(db, userId, optIn);
  revalidatePath("/velmju-saraksts");
  revalidatePath("/konts");
  return true;
}

export async function setThresholdAction(threshold: string): Promise<boolean> {
  const userId = await currentUserId();
  const t = z.enum(["any", "5", "10"]).safeParse(threshold);
  if (!userId || !t.success) return false;
  await setThreshold(db, userId, t.data);
  revalidatePath("/velmju-saraksts");
  return true;
}

/** Plan screen → provider checkout for the e-mail service. Redirects to the hosted page (or the mock). */
export async function startCheckoutAction(
  planId: string,
): Promise<never | { ok: false; reason: "auth" | "payments_off" | "invalid" }> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: "auth" };
  const provider = paymentsProvider();
  if (!provider) return { ok: false, reason: "payments_off" };
  if (!/^(monthly|annual)$/.test(planId)) return { ok: false, reason: "invalid" };
  const base = appBaseUrl();
  const [user] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId));
  const { redirectUrl } = await startSubscription(db, provider, {
    userId,
    planId,
    locale: user?.locale ?? "lv",
    description: "Trilio cenu paziņojumi",
    urls: {
      acceptUrl: `${base}${await localPath("/velmju-saraksts/apmaksats")}`,
      cancelUrl: `${base}${await localPath("/velmju-saraksts/atcelts")}`,
      callbackUrl: `${base}/api/payments/callback`,
    },
  });
  redirect(await localPath(redirectUrl ?? "/velmju-saraksts"));
}

export async function cancelSubscriptionAction(): Promise<boolean> {
  const userId = await currentUserId();
  return userId ? cancelAtPeriodEnd(db, userId) : false;
}

export async function resumeSubscriptionAction(): Promise<boolean> {
  const userId = await currentUserId();
  return userId ? resumeSubscription(db, userId) : false;
}
