import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { carrierById, formatIban, guaranteeMonths, withdrawalDeadline } from "@/domain/offers/offers";
import { formatDateDative, formatEur } from "@/i18n/format";
import type { EmailMessage, EmailSender } from "@/services/notify/email";
import { offersPaused } from "@/services/admin/audit";
import type { Invoice, OfferOrder, SpecialOffer } from "@/db/schema";
import { ensureOffersToken } from "./offers";
import { localizedPath, type UiLocale } from "@/i18n/routing";
import { offerProductName, signatureLine, subjectProductName } from "./compose";
import { emailShell, paragraphsWithLinks } from "./mail-layout";
import { guaranteeSheet, guaranteeText, sellerLine } from "./guarantee";
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
  /** "SIA Trilio · Reģ. Nr. … · address" for the small print, when configured. */
  company?: string;
};

/** The branded HTML for a plain-text order or reminder e-mail: same words, Trilio's header and small print. */
function branded(
  subject: string,
  text: string,
  deps: Pick<MailDeps, "baseUrl" | "company">,
  lang: UiLocale,
  extra: { footer?: string[]; unsubscribe?: { label: string; url: string } } = {},
): string {
  return emailShell({
    lang,
    title: subject,
    baseUrl: deps.baseUrl,
    tagline: offerCopyFor(lang).tagline,
    body: paragraphsWithLinks(text),
    footer: [...(extra.footer ?? []), deps.company ?? ""],
    unsubscribe: extra.unsubscribe,
  });
}

const orderUrl = (deps: Pick<MailDeps, "baseUrl">, order: OfferOrder, lang: UiLocale) =>
  `${deps.baseUrl}${localizedPath(`/konts/pasutijumi/${order.id}`, lang)}`;

export type OrderMail =
  "ordered" | "paid" | "shipped" | "delivered" | "return_requested" | "refunded" | "feedback";

export type OrderMailExtra = {
  deliveryBy?: Date;
  lang?: UiLocale;
  /** "ordered": the prepayment invoice; "paid": the final invoice (its guarantee sheet goes in the message). */
  invoice?: Invoice | null;
  /** "ordered": whether the order can be paid online (a payment provider is set up). */
  payOnline?: boolean;
};

const invoiceUrl = (deps: Pick<MailDeps, "baseUrl">, invoice: Invoice, lang: UiLocale) =>
  `${deps.baseUrl}${localizedPath(`/rekins/${invoice.id}`, lang)}`;

export function composeOrderEmail(
  kind: OrderMail,
  order: OfferOrder,
  offer: SpecialOffer,
  deps: Omit<MailDeps, "email">,
  extra: OrderMailExtra = {},
): EmailMessage {
  const message = orderText(kind, order, offer, deps, extra);
  return { ...message, html: branded(message.subject, message.text, deps, extra.lang ?? "lv") };
}

function orderText(
  kind: OrderMail,
  order: OfferOrder,
  offer: SpecialOffer,
  deps: Omit<MailDeps, "email">,
  extra: OrderMailExtra,
): EmailMessage {
  const lang = extra.lang ?? "lv";
  const c = offerCopyFor(lang);
  const url = orderUrl(deps, order, lang);
  const product = offerProductName(offer.productName);
  const base = { to: order.email, replyTo: deps.inbox };
  const sign = signatureLine(deps.signature, lang);
  switch (kind) {
    case "ordered": {
      // The prepayment invoice: what to pay, by when, and the two ways to pay it.
      const inv = extra.invoice;
      const number = inv?.number ?? order.number;
      const amount = formatEur(order.amountCents, lang);
      const seller = inv?.seller ?? {};
      return {
        ...base,
        subject: fill(c.prepaySubject, { invoice: number, number: order.number }),
        text: [
          fill(c.prepayBody, {
            invoice: number,
            product,
            amount,
            date: formatDateDative(inv?.dueAt ?? offer.validUntil, lang),
          }),
          extra.payOnline ? fill(c.prepayOnline, { url }) : "",
          seller.iban
            ? fill(c.prepayTransfer, {
                company: seller.name ?? "",
                iban: formatIban(seller.iban),
                bank: seller.bank ? ` (${[seller.bank, seller.swift].filter(Boolean).join(", ")})` : "",
                amount,
                invoice: number,
              })
            : "",
          inv ? fill(c.prepayView, { url: invoiceUrl(deps, inv, lang) }) : "",
          c.prepayAfter,
          sign,
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    }
    case "paid": {
      const inv = extra.invoice;
      return {
        ...base,
        subject: fill(c.paidSubject, { number: order.number }),
        text: [
          fill(c.paidBody, {
            amount: formatEur(order.amountCents, lang),
            product,
            date: extra.deliveryBy ? formatDateDative(extra.deliveryBy, lang) : "—",
          }),
          inv ? fill(c.paidInvoice, { invoice: inv.number, url: invoiceUrl(deps, inv, lang) }) : "",
          fill(c.orderLink, { url }),
          sign,
          // The guarantee sheet, in the message itself: the buyer keeps it without signing in.
          inv
            ? guaranteeText(
                guaranteeSheet(
                  {
                    buyerKind: order.buyerKind,
                    warrantyMonths: offer.warrantyMonths,
                    grade: offer.condition === "refurbished" ? (offer.grade ?? "") : null,
                    product: offer.productName,
                    orderNumber: order.number,
                    invoiceNumber: inv.number,
                    seller: sellerLine(inv.seller, lang),
                    email: deps.inbox,
                  },
                  lang,
                ),
              )
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    }
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
  extra: OrderMailExtra = {},
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
  const product = offerProductName(offer.productName);
  const body = [
    fill(c.reminderBody, { product, price, date }),
    fill(c.cta, { url: `${deps.baseUrl}${localizedPath(`/piedavajums/${offer.token}`, lang)}` }),
    signatureLine(deps.signature, lang),
  ].join("\n\n");
  const subject = fill(c.reminderSubject, { product: subjectProductName(offer.productName), price, date });
  const sent = await deps.email.send({
    to: user.email,
    replyTo: deps.inbox,
    subject,
    text: [body, c.consent, fill(c.footer, { url: unsubscribeUrl })].join("\n\n"),
    html: branded(subject, body, deps, lang, {
      footer: [c.consent],
      unsubscribe: { label: c.unsubscribe, url: unsubscribeUrl },
    }),
    headers: {
      "List-Unsubscribe": `<${deps.baseUrl}/api/offers/unsubscribe/${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  // Without an e-mail service (development) it counts as done; a failed send is retried next run.
  return sent.ok || sent.reason === "disabled";
}
