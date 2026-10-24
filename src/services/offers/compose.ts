import { deliveryBy, savingClaim } from "@/domain/offers/offers";
import { formatDateDative, formatDayLocative, formatEur } from "@/i18n/format";
import type { EmailMessage } from "@/services/notify/email";
import { localizedPath, type UiLocale } from "@/i18n/routing";
import { fill, offerCopyFor } from "./texts";

// The offer e-mail, pure: the admin's live preview in the browser and the
// sender on the server run this same function, so the preview is the e-mail.

export type OfferMailContext = { baseUrl: string; signature: string; replyTo?: string };

export type OfferDraft = {
  token: string | null;
  productName: string;
  priceCents: number;
  deliveryWorkingDays: number;
  referencePriceCents: number | null;
  referenceLow30Cents: number | null;
  condition: "new" | "refurbished";
  grade: string | null;
  warrantyMonths: number;
  message: string | null;
  validUntil: Date;
};

/**
 * The e-mail itself (§11.1): a note from a person, one product, starting
 * from what the reader saved. The preview in the admin is this same message.
 */
export function composeOfferEmail(
  offer: OfferDraft,
  ctx: OfferMailContext & {
    to: string;
    unsubscribeUrl: string;
    saved: { at: Date; priceCents: number | null } | null;
    now: Date;
    /** The reader's language (users.locale); the admin's own note stays as typed. */
    lang?: UiLocale;
  },
): EmailMessage {
  const lang = ctx.lang ?? "lv";
  const c = offerCopyFor(lang);
  const price = formatEur(offer.priceCents, lang);
  const url = `${ctx.baseUrl}${localizedPath(`/piedavajums/${offer.token ?? "…"}`, lang)}`;
  const lines: string[] = [c.greeting];
  if (ctx.saved?.priceCents)
    lines.push(
      fill(c.saved, {
        product: offer.productName,
        date: formatDayLocative(ctx.saved.at, lang),
        then: formatEur(ctx.saved.priceCents, lang),
      }),
    );
  else lines.push(fill(c.intro, { product: offer.productName }));
  lines.push(
    fill(c.deal, {
      price,
      date: formatDateDative(deliveryBy(ctx.now, offer.deliveryWorkingDays), lang),
    }),
  );
  const facts: string[] = [];
  if (offer.referencePriceCents)
    facts.push(fill(c.shops, { ref: formatEur(offer.referencePriceCents, lang) }));
  const saving = savingClaim(offer.priceCents, {
    priceCents: offer.referencePriceCents,
    low30Cents: offer.referenceLow30Cents,
  });
  if (saving) facts.push(fill(c.saving, { saving: formatEur(saving.savingCents, lang) }));
  if (facts.length) lines.push(facts.join(" "));
  if (offer.condition === "refurbished")
    lines.push(fill(c.refurbished, { grade: offer.grade ?? "—", months: offer.warrantyMonths }));
  lines.push(c.why);
  if (offer.message) lines.push(offer.message);
  lines.push(fill(c.valid, { date: formatDateDative(offer.validUntil, lang) }));
  lines.push(fill(c.cta, { url }));
  lines.push(fill(c.sign, { name: ctx.signature }));
  lines.push(fill(c.footer, { url: ctx.unsubscribeUrl }));
  return {
    to: ctx.to,
    subject: fill(c.subject, { name: ctx.signature, product: offer.productName, price }),
    text: lines.join("\n\n"),
    replyTo: ctx.replyTo,
    headers: {
      "List-Unsubscribe": `<${ctx.unsubscribeUrl.replace(/(\/en)?\/piedavajumi\/atteikties\//, "/api/offers/unsubscribe/")}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
