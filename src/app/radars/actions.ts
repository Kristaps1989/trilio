"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUserId } from "@/auth";
import { db, users } from "@/db";
import { loadProduct } from "@/db/queries/catalog";
import { createRadar, softDeleteRadar, updateRadar } from "@/db/queries/radar";
import { trackedOffer } from "@/domain/radar/evaluate";
import {
  cancelAtPeriodEnd,
  currentSubscription,
  hasAccess,
  resumeSubscription,
  startSubscription,
} from "@/services/billing/engine";
import { appBaseUrl, paymentsProvider } from "@/services/payments";

// Server actions for the radar (spec §5). Every one checks the session and
// scopes writes to the user's own rows.

const RadarSetup = z.object({
  productId: z.string().uuid(),
  searchSessionId: z.string().uuid().nullable(),
  threshold: z.enum(["any", "5", "10"]),
  scope: z.enum(["only", "brand", "any"]),
  channels: z.array(z.enum(["push", "email"])).min(1),
});
export type RadarSetupInput = z.infer<typeof RadarSetup>;

/** Called after the three setup questions. Requires sign-in and an active subscription. */
export async function createRadarAction(
  raw: unknown,
): Promise<{ ok: true; radarId: string } | { ok: false; reason: "auth" | "subscription" | "invalid" }> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: "auth" };
  const input = RadarSetup.safeParse(raw);
  if (!input.success) return { ok: false, reason: "invalid" };
  if (!hasAccess(await currentSubscription(db, userId))) return { ok: false, reason: "subscription" };
  const product = await loadProduct(db, input.data.productId);
  if (!product) return { ok: false, reason: "invalid" };
  const best = trackedOffer(product, { storeIds: [], includeRefurbished: false });
  const radar = await createRadar(db, userId, input.data, best?.priceCents ?? null);
  return { ok: true, radarId: radar.id };
}

const Patch = z.object({
  radarId: z.string().uuid(),
  threshold: z.enum(["any", "5", "10"]).optional(),
  scope: z.enum(["only", "brand", "any"]).optional(),
  storeIds: z.array(z.string().uuid()).optional(),
  includeRefurbished: z.boolean().optional(),
  channels: z
    .array(z.enum(["push", "email"]))
    .min(1)
    .optional(),
  paused: z.boolean().optional(),
});

export async function updateRadarAction(raw: unknown): Promise<boolean> {
  const userId = await currentUserId();
  const input = Patch.safeParse(raw);
  if (!userId || !input.success) return false;
  const { radarId, ...patch } = input.data;
  return updateRadar(db, userId, radarId, patch);
}

export async function deleteRadarAction(radarId: string, restore = false): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId || !z.string().uuid().safeParse(radarId).success) return false;
  return softDeleteRadar(db, userId, radarId, restore);
}

/** Plan screen → provider checkout. Redirects to the hosted page (or the mock). */
export async function startCheckoutAction(
  planId: string,
  returnTo: string,
): Promise<never | { ok: false; reason: "auth" | "payments_off" | "invalid" }> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: "auth" };
  const provider = paymentsProvider();
  if (!provider) return { ok: false, reason: "payments_off" };
  if (!/^(monthly|annual)$/.test(planId)) return { ok: false, reason: "invalid" };
  const base = appBaseUrl();
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/radars";
  const [user] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId));
  const { redirectUrl } = await startSubscription(db, provider, {
    userId,
    planId,
    locale: user?.locale ?? "lv",
    description: "Trilio Cenu radars",
    urls: {
      acceptUrl: `${base}/radars/apstiprinats?next=${encodeURIComponent(safeReturn)}`,
      cancelUrl: `${base}/radars/atcelts?next=${encodeURIComponent(safeReturn)}`,
      callbackUrl: `${base}/api/payments/callback`,
    },
  });
  redirect(redirectUrl ?? safeReturn);
}

export async function cancelSubscriptionAction(): Promise<boolean> {
  const userId = await currentUserId();
  return userId ? cancelAtPeriodEnd(db, userId) : false;
}

export async function resumeSubscriptionAction(): Promise<boolean> {
  const userId = await currentUserId();
  return userId ? resumeSubscription(db, userId) : false;
}
