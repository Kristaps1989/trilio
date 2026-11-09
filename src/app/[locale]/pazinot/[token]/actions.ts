"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { db } from "@/db";
import { recordUiEvent } from "@/services/notify/events";
import { judgeRequest } from "@/services/visits/judge";
import { confirmNotify } from "@/services/notify/requests";
import { localPath } from "@/i18n/path";
import { saveRequestItem } from "../save-request";

// "Apstiprināt": the account (made if needed), the item saved, price e-mails
// on, and the person signed in once, back on the page they asked from.

export async function confirmNotifyAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const result = await confirmNotify(db, token, saveRequestItem);
  if (!result.ok) redirect(await localPath(`/pazinot/${encodeURIComponent(token)}`));
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  await recordUiEvent(
    db,
    { ip, userAgent: h.get("user-agent"), suspect: await judgeRequest(h).catch(() => null) },
    "notify_confirmed",
    result.request.subcategoryId,
  ).catch(() => undefined);
  const back = result.request.returnPath ?? "/velmju-saraksts";
  const anchor =
    result.request.kind === "product" && result.request.productId ? `#p-${result.request.productId}` : "";
  const target = await localPath(`${back}${anchor}`);
  const session = await auth();
  if (session?.user?.id === result.userId) redirect(target);
  // Signs in once with the same link; if it was used already, the normal sign-in takes over.
  try {
    await signIn("notify", { token, redirectTo: target });
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "digest" in e &&
      String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    )
      throw e;
    redirect(await localPath(`/ienakt?callbackUrl=${encodeURIComponent(target)}`));
  }
}
