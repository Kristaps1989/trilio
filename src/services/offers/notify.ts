import type { Db } from "@/db/client";
import { deliveryBy } from "@/domain/offers/offers";
import { formatEur } from "@/i18n/format";
import { notifyInbox, sendOrderEmail, type MailDeps } from "./emails";
import { orderWithOffer } from "./orders";
import { userLang } from "./texts";

// What follows a step outside the admin: the buyer's confirmation and a note
// to Trilio's inbox, so a new order or a withdrawal is never missed.

export async function afterOrderPaid(
  db: Db,
  orderId: string,
  deps: MailDeps,
  now = new Date(),
): Promise<void> {
  const found = await orderWithOffer(db, orderId);
  if (!found) return;
  const { order, offer } = found;
  await sendOrderEmail("paid", order, offer, deps, {
    lang: await userLang(db, order.userId),
    deliveryBy: deliveryBy(now, offer.deliveryWorkingDays),
  });
  await notifyInbox(deps, `jauns pasūtījums ${order.number}`, [
    `${offer.productName} — ${formatEur(order.amountCents, "lv")}`,
    `${order.fullName}, ${order.phone ?? ""}`,
    `${deps.baseUrl}/admin/pasutijumi/${order.id}`,
  ]);
}

export async function afterWithdrawal(db: Db, orderId: string, deps: MailDeps): Promise<void> {
  const found = await orderWithOffer(db, orderId);
  if (!found) return;
  const { order, offer } = found;
  await sendOrderEmail("return_requested", order, offer, deps, { lang: await userLang(db, order.userId) });
  await notifyInbox(deps, `atteikums ${order.number}`, [
    `${offer.productName} — ${formatEur(order.amountCents, "lv")}`,
    `${order.fullName}, ${order.phone ?? ""}, ${order.email}`,
    `${deps.baseUrl}/admin/pasutijumi/${order.id}`,
  ]);
}

export async function afterProblemReported(db: Db, orderId: string, note: string | null, deps: MailDeps) {
  const found = await orderWithOffer(db, orderId);
  if (!found) return;
  const { order, offer } = found;
  await notifyInbox(deps, `problēma ar pasūtījumu ${order.number}`, [
    offer.productName,
    `${order.fullName}, ${order.phone ?? ""}, ${order.email}`,
    note ?? "",
    `${deps.baseUrl}/admin/pasutijumi/${order.id}`,
  ]);
}

/** Accepted while payments are not live yet: the admin follows up by hand. */
export async function afterAcceptedWithoutPayments(db: Db, orderId: string, deps: MailDeps) {
  const found = await orderWithOffer(db, orderId);
  if (!found) return;
  const { order, offer } = found;
  await notifyInbox(deps, `pieņemts piedāvājums ${order.number} (maksājumi vēl nav ieslēgti)`, [
    `${offer.productName} — ${formatEur(order.amountCents, "lv")}`,
    `${order.fullName}, ${order.phone ?? ""}, ${order.email}`,
    `${deps.baseUrl}/admin/pasutijumi/${order.id}`,
  ]);
}
