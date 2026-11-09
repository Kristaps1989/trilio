import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, savedItems } from "@/db";
import type { NotifyRequest } from "@/db/schema";
import { keyOf, saveTarget, type SaveTarget } from "../velmju-saraksts/save";

// What an "Iegūt lētāk" request saves to the wishlist: on sending the request
// (consent 2026-11-09.2 on) and again on the e-mailed link, which only renews it.

export function requestTarget(request: NotifyRequest): SaveTarget {
  return request.kind === "product" && request.productId
    ? { kind: "product", productId: request.productId }
    : {
        kind: "search",
        subcategoryId: request.subcategoryId,
        answersParam: request.answersParam ?? "",
        label: request.label ?? request.subcategoryId,
      };
}

export async function saveRequestItem(userId: string, request: NotifyRequest): Promise<boolean> {
  const target = requestTarget(request);
  const ok = await saveTarget(userId, target);
  // A save that started from an ad counts for that ad, as a heart tap does.
  if (ok && request.adLandingId)
    await db
      .update(savedItems)
      .set({ adLandingId: request.adLandingId })
      .where(
        and(eq(savedItems.userId, userId), eq(savedItems.key, keyOf(target)), isNull(savedItems.adLandingId)),
      );
  return ok;
}
