import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { carrierById, guaranteeMonths, withdrawalDeadline } from "@/domain/offers/offers";
import { formatDateDative, formatEur } from "@/i18n/format";
import type { EmailMessage, EmailSender } from "@/services/notify/email";
import { offersPaused } from "@/services/admin/audit";
import type { OfferOrder, SpecialOffer } from "@/db/schema";
import { ensureOffersToken } from "./offers";
import { localizedPath, type UiLocale } from "@/i18n/routing";
import { fill, offerCopyFor } from "./texts";

// The e-mails around an order: one per step the buyer cares about, and a
// note to Trilio's own inbox when something needs a hand. Plain text in the
// same voice as the offer (docs/ADMIN_AND_OFFERS_PLAN.md §5, §10, §11).

export type MailDeps = {
  email: EmailSender;
  baseUrl: string;
  signature: string;
  /** Trilio's inbox for replies, warranty claims and admin notes. */
  inbox: string;
};

const orderUrl = (deps: Pick<MailDeps, "baseUrl">, order: OfferOrder, lang: UiLocale) =>
  `${deps.baseUrl}${localizedPath(`/konts/pasutijumi/${order.id}`, lang)}`;

export type OrderMail = "paid" | "shipped" | "delivered" | "return_requested" | "refunded" | "feedback";

export function composeOrderEmail(
  kind: OrderMail,
  order: OfferOrder,
  offer: SpecialOffer,
  deps: Omit<MailDeps, "email">,
  extra: { deliveryBy?: Date; lang?: UiLocale } = {},
): EmailMessage {
  const lang = extra.lang ?? "lv";
  const c = offerCopyFor(lang);
  const url = orderUrl(deps, order, lang);
  const product = offer.productName;
  const base = { to: order.email, replyTo: deps.inbox };
  const sign = fill(c.sign, { name: deps.signature });
  switch (kind) {
    case "paid":
      return {
        ...base,
        subject: fill(c.paidSubject, { number: order.number }),
        text: [
          fill(c.paidBody, {
            amount: formatEur(order.amountCents, lang),
            product,
            date: extra.deliveryBy ? formatDateDative(extra.deliveryBy, lang) : "—",
          }),
          fill(c.orderLink, { url }),
          sign,
        ].join("\n\n"),
      };
    case "shipped":
      return {
        ...base,
        subject: fill(c.shippedSubject, { product }),
        text: [
          fill(c.shippedBody, {
            number: order.number,
            carrier: carrierById(order.carrier)?.name ?? order.carrier ?? "",
          }),
          order.trackingUrl ? fill(c.tracking, { url: order.trackingUrl }) : "",
          fill(c.orderLink, { url }),
          sign,
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    case "delivered": {
      const months = guaranteeMonths(order.buyerKind, offer.warrantyMonths);
      const deadline = withdrawalDeadline(order.deliveredAt);
      const body =
        order.buyerKind === "person" && deadline
          ? fill(c.deliveredPerson, {
              deadline: formatDateDative(deadline, lang),
              months,
              email: deps.inbox,
            })
          : fill(c.deliveredCompany, { months, email: deps.inbox });
      return {
        ...base,
        subject: fill(c.deliveredSubject, { number: order.number }),
        text: [body, fill(c.orderLink, { url }), sign].join("\n\n"),
      };
    }
    case "return_requested":
      return {
        ...base,
        subject: fill(c.returnSubject, { number: order.number }),
        text: [c.returnBody, fill(c.orderLink, { url }), sign].join("\n\n"),
      };
    case "refunded":
      return {
        ...base,
        subject: fill(c.refundSubject, { number: order.number }),
        text: [fill(c.refundBody, { amount: formatEur(order.amountCents, lang) }), sign].join("\n\n"),
      };
    case "feedback": {
      const answer = `${deps.baseUrl}${localizedPath(`/pasutijums/${order.feedbackToken}`, lang)}`;
      return {
        ...base,
        subject: fill(c.feedbackSubject, { product }),
        text: [
          fill(c.feedbackBody, { product }),
          fill(c.feedbackOk, { url: `${answer}?atbilde=ok` }),
          fill(c.feedbackProblem, { url: `${answer}?atbilde=problema` }),
          sign,
        ].join("\n\n"),
      };
    }
  }
}

export async function sendOrderEmail(
  kind: OrderMail,
  order: OfferOrder,
  offer: SpecialOffer,
  deps: MailDeps,
  extra: { deliveryBy?: Date; lang?: UiLocale } = {},
): Promise<boolean> {
  const sent = await deps.email.send(composeOrderEmail(kind, order, offer, deps, extra));
  return sent.ok;
}

/** A note to Trilio's inbox: a new paid order, a withdrawal, a reported problem. */
export async function notifyInbox(deps: MailDeps, subject: string, lines: string[]): Promise<void> {
  await deps.email.send({ to: deps.inbox, subject: `Trilio: ${subject}`, text: lines.join("\n") });
}

/** The one reminder before expiry, in the same voice; the last message about this offer. True when it is done. */
export async function sendReminder(db: Db, offer: SpecialOffer, deps: MailDeps): Promise<boolean> {
  if (!offer.userId || (await offersPaused(db))) return false;
  const [user] = await db
    .select({ email: users.email, optIn: users.offersOptIn, locale: users.locale })
    .from(users)
    .where(eq(users.id, offer.userId));
  if (!user?.optIn) return false;
  const lang: UiLocale = user.locale === "en" ? "en" : "lv";
  const unsub = await ensureOffersToken(db, offer.userId);
  const unsubscribeUrl = `${deps.baseUrl}${localizedPath(`/piedavajumi/atteikties/${unsub}`, lang)}`;
  const c = offerCopyFor(lang);
  const price = formatEur(offer.priceCents, lang);
  const date = formatDateDative(offer.validUntil, lang);
  const sent = await deps.email.send({
    to: user.email,
    replyTo: deps.inbox,
    subject: fill(c.reminderSubject, { product: offer.productName, price, date }),
    text: [
      fill(c.reminderBody, { product: offer.productName, price, date }),
      fill(c.cta, { url: `${deps.baseUrl}${localizedPath(`/piedavajums/${offer.token}`, lang)}` }),
      fill(c.sign, { name: deps.signature }),
      fill(c.footer, { url: unsubscribeUrl }),
    ].join("\n\n"),
    headers: {
      "List-Unsubscribe": `<${deps.baseUrl}/api/offers/unsubscribe/${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  // Without an e-mail service (development) it counts as done; a failed send is retried next run.
  return sent.ok || sent.reason === "disabled";
}
