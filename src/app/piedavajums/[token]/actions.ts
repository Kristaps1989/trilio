"use server";

import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { db } from "@/db";
import { parseOrderForm, type FieldError } from "@/domain/offers/checkout";
import { deliveryOptions } from "@/domain/offers/offers";
import { offerMailDeps } from "@/services/offers/deps";
import { omnivaLockers, lockerLabel } from "@/services/offers/lockers";
import { afterAcceptedWithoutPayments } from "@/services/offers/notify";
import { offerByToken, offerSignInUsed } from "@/services/offers/offers";
import { placeOrder, startOrderPayment } from "@/services/offers/orders";
import { appBaseUrl, paymentsProvider } from "@/services/payments";

// "Pieņemt piedāvājumu" and "Apmaksāt" (docs/ADMIN_AND_OFFERS_PLAN.md §5.3–5.4).

/** Signs the recipient in through the offer link and opens the order form; no second e-mail. */
export async function acceptOfferAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const offer = await offerByToken(db, token);
  if (!offer) redirect("/");
  const session = await auth();
  const target = `/piedavajums/${token}/pasutit`;
  if (session?.user?.id === offer.userId) redirect(target);
  // The link signs in once; after that (or for a forwarded link) the normal sign-in takes over.
  if (await offerSignInUsed(db, offer.id)) redirect(`/ienakt?callbackUrl=${encodeURIComponent(target)}`);
  await signIn("offer", { token, redirectTo: target });
}

/** Errors to show, and what was typed: React resets a submitted form, so the fields come back from here. */
export type CheckoutState = {
  errors: Partial<Record<string, FieldError>>;
  closed?: boolean;
  values?: Record<string, string>;
};

export async function placeOrderAction(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const token = String(formData.get("token") ?? "");
  const offer = await offerByToken(db, token);
  const session = await auth();
  if (!offer || !session?.user?.id || !session.user.email || offer.userId !== session.user.id)
    redirect(`/piedavajums/${token}`);
  const options = deliveryOptions(offer.subcategoryId);
  const lockers = options.locker ? await omnivaLockers() : [];
  const input = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)]));
  const parsed = parseOrderForm(input, {
    lockerAllowed: options.locker,
    refurbished: offer.condition === "refurbished",
    lockerName: (id) => {
      const l = lockers.find((x) => x.id === id);
      return l ? lockerLabel(l) : null;
    },
  });
  const values = Object.fromEntries(Object.entries(input).filter(([k]) => k !== "token"));
  if (!parsed.ok) return { errors: parsed.errors, values };
  const placed = await placeOrder(
    db,
    offer,
    { userId: session.user.id, email: session.user.email },
    parsed.order,
  );
  if (!placed.ok) {
    if (placed.reason === "already_paid") redirect("/konts/pasutijumi");
    return { errors: {}, closed: true, values };
  }
  const order = placed.order;
  const provider = paymentsProvider();
  if (!provider) {
    // Payments are not live yet (owner, 24 Oct 2026: Paysera only): the acceptance is recorded and Trilio writes.
    await afterAcceptedWithoutPayments(db, order.id, offerMailDeps());
    redirect(`/konts/pasutijumi/${order.id}?gaida=1`);
  }
  const base = appBaseUrl();
  const url = await startOrderPayment(db, provider, order, offer, {
    acceptUrl: `${base}/konts/pasutijumi/${order.id}?apmaksats=1`,
    cancelUrl: `${base}/piedavajums/${token}/pasutit?atcelts=1`,
    callbackUrl: `${base}/api/payments/callback`,
  });
  redirect(url ?? `/konts/pasutijumi/${order.id}`);
}
