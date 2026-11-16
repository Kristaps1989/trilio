import { cleanName } from "@/domain/catalog/naming";
import { deliveryBy, savingClaim } from "@/domain/offers/offers";
import { formatDateDative, formatDayLocative, formatEur } from "@/i18n/format";
import type { EmailMessage } from "@/services/notify/email";
import { localizedPath, type UiLocale } from "@/i18n/routing";
import {
  aside,
  button,
  centred,
  compareTable,
  type CompareRow,
  described,
  emailShell,
  hero,
  subheading,
  kicker,
  paragraph,
  type Perk,
  perks,
  outlineButton,
  priceHero,
  productHero,
  swapCard,
  thumbnails,
} from "./mail-layout";
import { answerCopyFor, fill, offerCopyFor } from "./texts";

// The offer e-mail, pure: the admin's live preview in the browser and the
// sender on the server run this same function, so the preview is the e-mail.
// One product, its price and delivery as a table, one button (§11.1).

export type OfferMailContext = {
  baseUrl: string;
  /** A person's name ("Kristaps") or just "Trilio" (OFFERS_SENDER_NAME). */
  signature: string;
  replyTo?: string;
  /** Trilio's inbox: replies go there and the e-mail names it for questions. */
  inbox?: string;
  /** "SIA Trilio · Reģ. Nr. … · address" for the small print, when configured. */
  company?: string;
};

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
  /** The product picture: a site path or an allowed shop image (https). */
  imageUrl?: string | null;
  /** Pictures the admin added (site paths, Trilio's own copies); the first is the main one. */
  imageUrls?: string[];
  /** The admin's description, shown as "Trilio apraksts". */
  description?: string | null;
  /** Set when this is another maker's product offered in place of the one asked for. */
  alternative?: AlternativeMail | null;
};

/** What the alternative e-mail shows, already in the reader's language (services/offers/alternative.ts). */
export type AlternativeMail = {
  askedName: string;
  equivalent: boolean;
  rows: CompareRow[];
  /** "Trokšņa līmenis — sliktāk", … ; empty when equivalent. */
  downsides: string[];
  originalSeenCents: number | null;
  requestedAt: Date | null;
  declineUrl: string;
  watchUntil: Date | null;
};

/** Longest product name a subject line carries; cut at a comma so no word is broken. */
export const SUBJECT_NAME_MAX = 40;

/** The product's name without the shop's trailing type word ("… balta - Ledusskapis"). */
export function offerProductName(name: string): string {
  return cleanName(name) || name.trim();
}

/** A short name for the subject: whole comma-separated parts up to SUBJECT_NAME_MAX characters. */
export function subjectProductName(name: string): string {
  const clean = offerProductName(name);
  if (clean.length <= SUBJECT_NAME_MAX) return clean;
  const parts = clean.split(/,\s*/);
  let out = parts[0]!;
  for (const p of parts.slice(1)) {
    if (`${out}, ${p}`.length > SUBJECT_NAME_MAX) break;
    out = `${out}, ${p}`;
  }
  return out.length <= SUBJECT_NAME_MAX + 20 ? out : `${clean.slice(0, SUBJECT_NAME_MAX).trimEnd()}…`;
}

/** Latvian "1 darba dienas", "21 darba dienas" but "3 darba dienu"; English "1 working day". */
export function isOne(n: number, lang: UiLocale): boolean {
  return lang === "en" ? n === 1 : n % 10 === 1 && n % 100 !== 11;
}

/** The picture as mail clients can load it: through the site's own image optimiser. */
export function emailImageUrl(baseUrl: string, src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.startsWith("/")) return `${baseUrl}${src}`;
  if (!src.startsWith("https://")) return null;
  return `${baseUrl}/_next/image?url=${encodeURIComponent(src)}&w=256&q=80`;
}

/** "6. novembrim" with a no-break space, so a date never splits across lines. */
export function keepTogether(date: string): string {
  return date.replace(/(\d+\.) /g, "$1\u00a0");
}

export function signatureLine(signature: string, lang: UiLocale): string {
  const c = offerCopyFor(lang);
  const name = signature.trim();
  return !name || name.toLowerCase() === "trilio" ? c.signTeam : fill(c.sign, { name });
}

export function composeOfferEmail(
  offer: OfferDraft,
  ctx: OfferMailContext & {
    to: string;
    /** The one-step unsubscribe; for an unconfirmed request it deletes the request (docs/REQUEST_OFFER_PLAN.md). */
    unsubscribeUrl?: string;
    /**
     * A proposal answering an "Iegūt lētāk" request whose address is not confirmed
     * (docs/REQUEST_OFFER_PLAN.md): when it was asked, and the link that confirms the
     * address and follows the price. The e-mail says why it came, and how to stop.
     */
    request?: { at: Date; followUrl: string };
    saved: { at: Date; priceCents: number | null } | null;
    now: Date;
    /** The reader's language (users.locale); the admin's own note stays as typed. */
    lang?: UiLocale;
  },
): EmailMessage {
  const lang = ctx.lang ?? "lv";
  if (offer.alternative) return composeAlternativeEmail(offer, offer.alternative, ctx);
  const c = offerCopyFor(lang);
  const price = formatEur(offer.priceCents, lang);
  const url = `${ctx.baseUrl}${localizedPath(`/piedavajums/${offer.token ?? "…"}`, lang)}`;
  const name = offerProductName(offer.productName);
  const valid = keepTogether(formatDateDative(offer.validUntil, lang));
  const days = Math.max(1, offer.deliveryWorkingDays);
  const saving = savingClaim(offer.priceCents, {
    priceCents: offer.referencePriceCents,
    low30Cents: offer.referenceLow30Cents,
  });

  const savingText = saving ? formatEur(saving.savingCents, lang) : null;
  // A number never starts a line on its own: "Par 49,99 €" and "6. novembrim" stay together.
  const headline = (
    savingText ? fill(c.heroCheaper, { saving: savingText }) : fill(c.hero, { price })
  ).replace(/ (?=\d)/g, "\u00a0");
  const asked = ctx.request ? formatDayLocative(ctx.request.at, lang) : null;
  const opening = asked
    ? fill(c.requestIntro, { date: asked })
    : ctx.saved?.priceCents
      ? fill(c.saved, {
          date: formatDayLocative(ctx.saved.at, lang),
          then: formatEur(ctx.saved.priceCents, lang),
        })
      : c.intro;
  const priceLines = [
    offer.referencePriceCents ? fill(c.shopsNow, { ref: formatEur(offer.referencePriceCents, lang) }) : "",
    savingText ? fill(c.savingNote, { saving: savingText }) : "",
  ].filter(Boolean);

  // New goods carry at least the two-year legal guarantee, as the offer page says.
  const months = offer.condition === "new" ? Math.max(24, offer.warrantyMonths) : offer.warrantyMonths;
  const list: Perk[] = [
    { text: c.perkDelivery },
    {
      text: fill(isOne(days, lang) ? c.perkArrivesOne : c.perkArrives, { days }),
      note: fill(c.perkArrivesNote, {
        date: keepTogether(formatDateDative(deliveryBy(ctx.now, days), lang)),
      }),
    },
  ];
  if (offer.condition === "refurbished")
    list.push({ text: fill(c.perkRefurbished, { grade: offer.grade ?? "—" }) });
  if (months > 0) list.push({ text: fill(c.perkWarranty, { months }) });

  const replyTo = ctx.replyTo ?? ctx.inbox;
  const questions = ctx.inbox ? fill(c.questions, { email: ctx.inbox }) : null;
  const sign = signatureLine(ctx.signature, lang);
  const validLine = fill(c.valid, { date: valid });

  // Plain text: the same message in the same order.
  const text = [
    headline,
    `${name}\n${price}${priceLines.length ? `\n${priceLines.join("\n")}` : ""}`,
    opening,
    list.map((p) => `• ${p.text}${p.note ? `. ${p.note}` : ""}`).join("\n"),
    `${fill(c.cta, { url })}\n${validLine}`,
    // "Kāpēc lētāk?" only when the e-mail says it is cheaper.
    saving ? `${c.whyTitle} ${c.why}` : null,
    offer.description ? `${answerCopyFor(lang).descriptionTitle}\n${offer.description}` : null,
    offer.message,
    c.noPressure,
    questions,
    ctx.request ? fill(c.followLine, { url: ctx.request.followUrl }) : null,
    sign,
    (asked
      ? [
          fill(c.requestReason, { date: asked }),
          ctx.unsubscribeUrl ? fill(c.footer, { url: ctx.unsubscribeUrl }) : null,
          ctx.company,
        ]
      : [c.consent, ctx.unsubscribeUrl ? fill(c.footer, { url: ctx.unsubscribeUrl }) : null, ctx.company]
    )
      .filter(Boolean)
      .join("\n"),
  ]
    .filter((x): x is string => !!x)
    .join("\n\n");

  const pictures = offerPictures(ctx.baseUrl, offer);
  const body = [
    kicker(c.kicker),
    hero(headline),
    centred(opening),
    productHero(name, pictures[0] ?? null),
    thumbnails(pictures.slice(1)),
    priceHero(price, priceLines),
    offer.description ? described(answerCopyFor(lang).descriptionTitle, offer.description) : "",
    perks(list),
    button(fill(c.button, { price }), url),
    centred(validLine, "font-size:14px"),
    saving ? aside(c.whyTitle, c.why) : "",
    offer.message ? aside(null, offer.message) : "",
    paragraph(c.noPressure, "font-size:15px"),
    questions ? paragraph(questions, "font-size:15px") : "",
    ctx.request ? paragraph(c.followAsk, "font-size:15px") : "",
    ctx.request ? button(c.follow, ctx.request.followUrl) : "",
    paragraph(sign, "font-weight:600"),
  ].join("");

  const subject = fill(saving ? c.subjectCheaper : c.subject, {
    product: subjectProductName(offer.productName),
    price,
  });
  const html = emailShell({
    lang,
    title: subject,
    baseUrl: ctx.baseUrl,
    preheader: fill(c.preheader, { date: valid }),
    tagline: c.tagline,
    body,
    footer: asked
      ? [fill(c.requestReason, { date: asked }), ctx.company ?? ""]
      : [c.consent, ctx.company ?? ""],
    ...(ctx.unsubscribeUrl ? { unsubscribe: { label: c.unsubscribe, url: ctx.unsubscribeUrl } } : {}),
  });

  return {
    to: ctx.to,
    subject,
    text,
    html,
    ...(replyTo ? { replyTo } : {}),
    ...(ctx.unsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${ctx.unsubscribeUrl.replace(/(\/en)?\/piedavajumi\/atteikties\//, "/api/offers/unsubscribe/")}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  };
}

/** The pictures as mail clients load them: the admin's own first, else the catalogue's. */
export function offerPictures(baseUrl: string, offer: Pick<OfferDraft, "imageUrl" | "imageUrls">): string[] {
  const own = (offer.imageUrls ?? []).map((u) => emailImageUrl(baseUrl, u)).filter((u): u is string => !!u);
  if (own.length) return own;
  const one = emailImageUrl(baseUrl, offer.imageUrl);
  return one ? [one] : [];
}

/**
 * Another maker's product in place of the one asked for (docs/ALTERNATIVE_OFFER_PLAN.md
 * §4.1). The swap is in the subject, the headline and a card at the top; both products
 * are compared line by line with the worse lines named; the reader can say "only my
 * model" with one button, and is told the original's price is still followed.
 */
function composeAlternativeEmail(
  offer: OfferDraft,
  alt: AlternativeMail,
  ctx: Parameters<typeof composeOfferEmail>[1],
): EmailMessage {
  const lang = ctx.lang ?? "lv";
  const c = offerCopyFor(lang);
  const a = answerCopyFor(lang);
  const price = formatEur(offer.priceCents, lang);
  const url = `${ctx.baseUrl}${localizedPath(`/piedavajums/${offer.token ?? "…"}`, lang)}`;
  const name = offerProductName(offer.productName);
  const asked = offerProductName(alt.askedName);
  const valid = keepTogether(formatDateDative(offer.validUntil, lang));
  const days = Math.max(1, offer.deliveryWorkingDays);
  const saving = savingClaim(offer.priceCents, {
    priceCents: offer.referencePriceCents,
    low30Cents: offer.referenceLow30Cents,
  });
  const savingText = saving ? formatEur(saving.savingCents, lang) : null;
  const headline = (alt.equivalent ? a.altHeroEquivalent : a.altHeroSimilar).replace(/ (?=\d)/g, "\u00a0");
  const opening = alt.requestedAt
    ? fill(a.altIntroRequest, { date: formatDayLocative(alt.requestedAt, lang), asked })
    : fill(a.altIntroSaved, { asked });
  const priceLines = [
    alt.originalSeenCents ? fill(a.askedSeen, { asked, price: formatEur(alt.originalSeenCents, lang) }) : "",
    offer.referencePriceCents ? fill(a.shopsNow, { ref: formatEur(offer.referencePriceCents, lang) }) : "",
    savingText ? fill(c.savingNote, { saving: savingText }) : "",
  ].filter(Boolean);
  const months = offer.condition === "new" ? Math.max(24, offer.warrantyMonths) : offer.warrantyMonths;
  const list: Perk[] = [
    { text: c.perkDelivery },
    {
      text: fill(isOne(days, lang) ? c.perkArrivesOne : c.perkArrives, { days }),
      note: fill(c.perkArrivesNote, {
        date: keepTogether(formatDateDative(deliveryBy(ctx.now, days), lang)),
      }),
    },
  ];
  if (offer.condition === "refurbished")
    list.push({ text: fill(c.perkRefurbished, { grade: offer.grade ?? "—" }) });
  if (months > 0) list.push({ text: fill(c.perkWarranty, { months }) });
  const downsides = alt.downsides.length ? fill(a.downsides, { list: alt.downsides.join("; ") }) : null;
  const watch = alt.watchUntil
    ? fill(a.keepWatching, { asked, date: keepTogether(formatDateDative(alt.watchUntil, lang)) })
    : null;
  const replyTo = ctx.replyTo ?? ctx.inbox;
  const questions = ctx.inbox ? fill(c.questions, { email: ctx.inbox }) : null;
  const sign = signatureLine(ctx.signature, lang);
  const validLine = fill(c.valid, { date: valid });
  const reason = alt.requestedAt
    ? fill(a.reasonRequest, { date: formatDayLocative(alt.requestedAt, lang), asked })
    : a.reasonSaved;
  const pictures = offerPictures(ctx.baseUrl, offer);

  const text = [
    headline,
    opening,
    `${a.askedLabel}: ${asked} (${a.askedNote})\n${a.offeredLabel}: ${name}`,
    `${price}${priceLines.length ? `\n${priceLines.join("\n")}` : ""}`,
    `${a.compareTitle}\n${alt.rows
      .map((r) => `• ${r.label}: ${r.asked} → ${r.offered}${r.verdict ? ` (${r.verdict.text})` : ""}`)
      .join("\n")}`,
    alt.equivalent ? a.equivalentNote : downsides ? `${a.downsidesTitle}: ${downsides}` : null,
    offer.description ? `${a.descriptionTitle}\n${offer.description}` : null,
    list.map((p) => `• ${p.text}${p.note ? `. ${p.note}` : ""}`).join("\n"),
    `${a.button}: ${url}\n${validLine}`,
    `${a.declineHint}\n${a.decline}: ${alt.declineUrl}`,
    watch,
    offer.message,
    questions,
    sign,
    [reason, ctx.unsubscribeUrl ? fill(c.footer, { url: ctx.unsubscribeUrl }) : null, ctx.company]
      .filter(Boolean)
      .join("\n"),
  ]
    .filter((x): x is string => !!x)
    .join("\n\n");

  const body = [
    kicker(a.kicker),
    hero(headline),
    centred(opening),
    swapCard({ label: a.askedLabel, name: asked, note: a.askedNote }, { label: a.offeredLabel, name }),
    productHero(name, pictures[0] ?? null),
    thumbnails(pictures.slice(1)),
    priceHero(price, priceLines),
    alt.rows.length
      ? subheading(a.compareTitle) +
        compareTable({ label: a.colAttr, asked: a.colAsked, offered: a.colOffered }, alt.rows)
      : "",
    alt.equivalent ? centred(a.equivalentNote, "font-size:14px") : downsides ? aside(a.downsidesTitle, downsides) : "",
    offer.description ? described(a.descriptionTitle, offer.description) : "",
    perks(list),
    button(a.button, url),
    centred(validLine, "font-size:14px"),
    centred(a.declineHint, "font-size:14px;margin-bottom:8px"),
    outlineButton(a.decline, alt.declineUrl),
    watch ? paragraph(watch, "font-size:15px") : "",
    offer.message ? aside(null, offer.message) : "",
    questions ? paragraph(questions, "font-size:15px") : "",
    paragraph(sign, "font-weight:600"),
  ].join("");

  const subject = fill(a.altSubject, {
    asked: subjectProductName(alt.askedName),
    offered: subjectProductName(offer.productName),
  });
  const html = emailShell({
    lang,
    title: subject,
    baseUrl: ctx.baseUrl,
    preheader: fill(a.altPreheader, { date: valid }),
    tagline: c.tagline,
    body,
    footer: [reason, ctx.company ?? ""],
    ...(ctx.unsubscribeUrl ? { unsubscribe: { label: c.unsubscribe, url: ctx.unsubscribeUrl } } : {}),
  });
  return {
    to: ctx.to,
    subject,
    text,
    html,
    ...(replyTo ? { replyTo } : {}),
    ...(ctx.unsubscribeUrl
      ? {
          headers: {
            "List-Unsubscribe": `<${ctx.unsubscribeUrl.replace(/(\/en)?\/piedavajumi\/atteikties\//, "/api/offers/unsubscribe/")}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  };
}
