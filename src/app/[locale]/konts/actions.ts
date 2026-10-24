"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { currentUserId, signOut } from "@/auth";
import { db, subscriptions, users } from "@/db";
import { forgetBuyer } from "@/services/offers/privacy";
import { localPath } from "@/i18n/path";
import { isUiLocale } from "@/i18n/routing";

// GDPR: account deletion. Hard delete; saved items, radars, sessions, accounts, push
// subscriptions and subscriptions cascade from the users row. Billing stays
// consistent: a live subscription is marked canceled first so the scheduler
// never charges a deleted token (the row is removed by the cascade anyway).

export async function deleteAccountAction(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) redirect(await localPath("/ienakt?callbackUrl=/konts"));
  await db
    .update(subscriptions)
    .set({ status: "canceled", canceledAt: new Date(), nextBillingAt: null, tokenEncrypted: null })
    .where(eq(subscriptions.userId, userId));
  // Offers nobody bought go; paid orders stay for accounting, without what the courier needed.
  await forgetBuyer(db, userId);
  await db.delete(users).where(eq(users.id, userId));
  await signOut({ redirectTo: await localPath("/?deleted=1") });
}

/** The language of the e-mails Trilio sends to this account (users.locale). */
export async function setEmailLanguageAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  if (!userId) redirect(await localPath("/ienakt?callbackUrl=/konts"));
  const value = formData.get("locale");
  const locale = isUiLocale(value) ? value : "lv";
  await db.update(users).set({ locale }).where(eq(users.id, userId));
  redirect(await localPath("/konts?valoda=1#valoda"));
}
