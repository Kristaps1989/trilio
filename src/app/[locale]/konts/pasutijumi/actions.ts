"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUserId } from "@/auth";
import { db } from "@/db";
import { canWithdraw } from "@/domain/offers/offers";
import { offerMailDeps } from "@/services/offers/deps";
import { sendOrderEmail } from "@/services/offers/emails";
import { afterWithdrawal } from "@/services/offers/notify";
import { moveOrder, orderById, orderWithOffer } from "@/services/offers/orders";
import { localPath } from "@/i18n/path";
import { userLang } from "@/services/offers/texts";

// The buyer's two actions on an order: "Saņēmu preci" and the withdrawal.

async function ownOrder(formData: FormData) {
  const userId = await currentUserId();
  const id = z.string().uuid().safeParse(formData.get("orderId"));
  if (!userId || !id.success) redirect(await localPath("/konts/pasutijumi"));
  const order = await orderById(db, id.data);
  if (!order || order.userId !== userId) redirect(await localPath("/konts/pasutijumi"));
  return order;
}

export async function confirmDeliveryAction(formData: FormData): Promise<void> {
  const order = await ownOrder(formData);
  if (order.status === "shipped") {
    const moved = await moveOrder(db, order.id, { to: "delivered", by: "buyer" });
    const found = moved.ok ? await orderWithOffer(db, order.id) : null;
    if (found)
      await sendOrderEmail("delivered", found.order, found.offer, offerMailDeps(), {
        lang: await userLang(db, found.order.userId),
      });
  }
  revalidatePath(`/konts/pasutijumi/${order.id}`);
  redirect(await localPath(`/konts/pasutijumi/${order.id}`));
}

/** "Atteikties no pirkuma": private buyers, within 14 days of delivery or before it. */
export async function withdrawAction(formData: FormData): Promise<void> {
  const order = await ownOrder(formData);
  if (canWithdraw(order, new Date())) {
    const moved = await moveOrder(db, order.id, { to: "return_requested", by: "buyer" });
    if (moved.ok) await afterWithdrawal(db, order.id, offerMailDeps());
  }
  revalidatePath(`/konts/pasutijumi/${order.id}`);
  redirect(await localPath(`/konts/pasutijumi/${order.id}`));
}
