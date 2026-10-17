"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { currentUserId, signOut } from "@/auth";
import { db, subscriptions, users } from "@/db";

// GDPR: account deletion. Hard delete; radars, sessions, accounts, push
// subscriptions and subscriptions cascade from the users row. Billing stays
// consistent: a live subscription is marked canceled first so the scheduler
// never charges a deleted token (the row is removed by the cascade anyway).

export async function deleteAccountAction(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) redirect("/ienakt?callbackUrl=/konts");
  await db
    .update(subscriptions)
    .set({ status: "canceled", canceledAt: new Date(), nextBillingAt: null, tokenEncrypted: null })
    .where(eq(subscriptions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await signOut({ redirectTo: "/?deleted=1" });
}
