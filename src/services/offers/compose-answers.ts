import type lv from "@/i18n/messages/lv.json";
import { formatDateDative, formatDayLocative, formatEur } from "@/i18n/format";
import { localizedPath, type UiLocale } from "@/i18n/routing";
import type { EmailMessage } from "@/services/notify/email";
import {
  keepTogether,
  offerProductName,
  signatureLine,
  subjectProductName,
  type OfferMailContext,
} from "./compose";
import {
  button,
  centred,
  emailShell,
  hero,
  kicker,
  outlineButton,
  paragraph,
  productCard,
} from "./mail-layout";
import { answerCopyFor, fill } from "./texts";

export { answerCopyFor };

// Trilio's answers to a price request that are not an offer for the product asked for
// (docs/ALTERNATIVE_OFFER_PLAN.md §4): "nothing to offer", and the question asked
// first when the request's text did not mention an alternative. Pure, like the offer
// e-mail, so the admin's preview is exactly what goes out.

export type AnswerContext = OfferMailContext & {
  to: string;
  lang?: UiLocale;
  /** The product asked for. */
  askedName: string;
  /** When the lower price was requested; null for someone who only saved it with offers allowed. */
  requestedAt: Date | null;
  /** The price e-mails for this product run until then (null: not known). */
  watchUntil: Date | null;
  unsubscribeUrl?: string;
};

function intro(
  c: typeof lv.answerEmail,
  kind: "nothing" | "ask",
  ctx: AnswerContext,
  lang: UiLocale,
): string {
  const asked = offerProductName(ctx.askedName);
  if (ctx.requestedAt)
    return fill(kind === "nothing" ? c.nothingIntroRequest : c.askIntroRequest, {
      date: formatDayLocative(ctx.requestedAt, lang),
      asked,
    });
  return fill(kind === "nothing" ? c.nothingIntroSaved : c.askIntroSaved, { asked });
}

function footerLines(c: typeof lv.answerEmail, ctx: AnswerContext, lang: UiLocale): string[] {
  const asked = offerProductName(ctx.askedName);
  return [
    ctx.requestedAt
      ? fill(c.reasonRequest, { date: formatDayLocative(ctx.requestedAt, lang), asked })
      : c.reasonSaved,
    ctx.company ?? "",
  ];
}

function sign(ctx: AnswerContext, lang: UiLocale): string {
  return signatureLine(ctx.signature, lang);
}

function headers(ctx: AnswerContext) {
  return ctx.unsubscribeUrl
    ? {
        headers: {
          "List-Unsubscribe": `<${ctx.unsubscribeUrl.replace(/(\/en)?\/piedavajumi\/atteikties\//, "/api/offers/unsubscribe/")}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }
    : {};
}

/**
 * "Šoreiz lētāk nesanāca": one short message, never repeated, no other product,
 * no advertising and no urgency (§4.4). Says the price is still being watched.
 */
export function composeNothingEmail(ctx: AnswerContext & { shopCents: number | null }): EmailMessage {
  const lang = ctx.lang ?? "lv";
  const c = answerCopyFor(lang);
  const asked = offerProductName(ctx.askedName);
  const watch = ctx.watchUntil
    ? fill(c.nothingWatch, { date: keepTogether(formatDateDative(ctx.watchUntil, lang)) })
    : c.nothingWatchNoDate;
  const shops = ctx.shopCents ? fill(c.nothingShops, { price: formatEur(ctx.shopCents, lang) }) : null;
  const wishlist = `${ctx.baseUrl}${localizedPath("/velmju-saraksts", lang)}`;
  const opening = intro(c, "nothing", ctx, lang);
  const subject = fill(c.nothingSubject, { asked: subjectProductName(ctx.askedName) });
  const replyTo = ctx.replyTo ?? ctx.inbox;
  const text = [
    c.nothingHero,
    opening,
    shops ? `${asked}\n${shops}` : asked,
    watch,
    `${c.wishlist}: ${wishlist}`,
    sign(ctx, lang),
    [...footerLines(c, ctx, lang), ctx.unsubscribeUrl ? fill(c.footer, { url: ctx.unsubscribeUrl }) : null]
      .filter(Boolean)
      .join("\n"),
  ].join("\n\n");
  const body = [
    kicker(c.kicker),
    hero(c.nothingHero),
    centred(opening),
    productCard(asked, shops ? [shops] : []),
    paragraph(watch, "text-align:center"),
    outlineButton(c.wishlist, wishlist),
    paragraph(sign(ctx, lang), "font-weight:600"),
  ].join("");
  return {
    to: ctx.to,
    subject,
    text,
    html: emailShell({
      lang,
      title: subject,
      baseUrl: ctx.baseUrl,
      preheader: c.nothingPreheader,
      tagline: c.tagline,
      body,
      footer: footerLines(c, ctx, lang),
      ...(ctx.unsubscribeUrl ? { unsubscribe: { label: c.unsubscribe, url: ctx.unsubscribeUrl } } : {}),
    }),
    ...(replyTo ? { replyTo } : {}),
    ...headers(ctx),
  };
}

/**
 * The question asked first (§4.3), for people whose request text did not mention an
 * alternative: two buttons, each to a page with one more confirming button, so a
 * mail scanner that opens links never answers for the person.
 */
export function composeAskEmail(ctx: AnswerContext & { yesUrl: string; noUrl: string }): EmailMessage {
  const lang = ctx.lang ?? "lv";
  const c = answerCopyFor(lang);
  const opening = intro(c, "ask", ctx, lang);
  const subject = fill(c.askSubject, { asked: subjectProductName(ctx.askedName) });
  const noAnswer = ctx.watchUntil
    ? fill(c.askNoAnswer, { date: keepTogether(formatDateDative(ctx.watchUntil, lang)) })
    : c.nothingWatchNoDate;
  const replyTo = ctx.replyTo ?? ctx.inbox;
  const text = [
    c.askHero,
    opening,
    c.askQuestion,
    `${c.askYes}: ${ctx.yesUrl}\n${c.askNo}: ${ctx.noUrl}`,
    noAnswer,
    sign(ctx, lang),
    [...footerLines(c, ctx, lang), ctx.unsubscribeUrl ? fill(c.footer, { url: ctx.unsubscribeUrl }) : null]
      .filter(Boolean)
      .join("\n"),
  ].join("\n\n");
  const body = [
    kicker(c.kicker),
    hero(c.askHero),
    centred(opening),
    paragraph(c.askQuestion, "text-align:center;font-weight:600"),
    button(c.askYes, ctx.yesUrl),
    outlineButton(c.askNo, ctx.noUrl),
    centred(noAnswer, "font-size:14px"),
    paragraph(sign(ctx, lang), "font-weight:600"),
  ].join("");
  return {
    to: ctx.to,
    subject,
    text,
    html: emailShell({
      lang,
      title: subject,
      baseUrl: ctx.baseUrl,
      preheader: c.askPreheader,
      tagline: c.tagline,
      body,
      footer: footerLines(c, ctx, lang),
      ...(ctx.unsubscribeUrl ? { unsubscribe: { label: c.unsubscribe, url: ctx.unsubscribeUrl } } : {}),
    }),
    ...(replyTo ? { replyTo } : {}),
    ...headers(ctx),
  };
}
