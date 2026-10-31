import { formatEur } from "@/i18n/format";
import en from "@/i18n/messages/en.json";
import lv from "@/i18n/messages/lv.json";
import { localizedPath, type UiLocale } from "@/i18n/routing";
import type { EmailMessage } from "@/services/notify/email";
import { emailImageUrl, offerProductName, subjectProductName } from "@/services/offers/compose";
import { button, centred, emailShell, hero, paragraph, productHero } from "@/services/offers/mail-layout";
import { fill } from "@/services/offers/texts";
import type { NotifyTarget } from "./requests";

// The one e-mail before any other (double opt-in): what was asked, one button,
// and that nothing follows without the click. Same shell as the offer e-mails.

export function composeNotifyConfirmEmail(input: {
  to: string;
  lang: UiLocale;
  baseUrl: string;
  company?: string;
  token: string;
  target: NotifyTarget;
  /** The consent covered Trilio's offers: the e-mail promises a better price, not only the price e-mail. */
  offers: boolean;
}): EmailMessage {
  const m = input.lang === "en" ? en.notifyEmail : lv.notifyEmail;
  const c = input.offers
    ? m
    : { ...m, title: m.titlePlain, subject: m.subjectPlain, product: m.productPlain };
  const t = input.target;
  const url = `${input.baseUrl}${localizedPath(`/pazinot/${input.token}`, input.lang)}`;
  const name = t.kind === "product" ? offerProductName(t.name) : t.label;
  const lead = t.kind === "product" ? c.product : c.search;
  const price =
    t.kind === "product" && t.priceCents ? fill(c.now, { price: formatEur(t.priceCents, input.lang) }) : null;
  const subject = fill(c.subject, { product: t.kind === "product" ? subjectProductName(t.name) : t.label });
  const text = [
    lead,
    [name, price].filter(Boolean).join("\n"),
    c.cta,
    fill(c.link, { url }),
    c.valid,
    c.notYou,
  ]
    .filter(Boolean)
    .join("\n\n");
  const body = [
    hero(c.title),
    centred(lead),
    productHero(name, t.kind === "product" ? emailImageUrl(input.baseUrl, t.imageUrl) : null),
    price ? centred(price, "font-weight:600") : "",
    centred(c.cta),
    button(c.button, url),
    centred(c.valid, "font-size:14px"),
    paragraph(c.notYou, "font-size:14px"),
  ].join("");
  return {
    to: input.to,
    subject,
    text,
    html: emailShell({
      lang: input.lang,
      title: subject,
      baseUrl: input.baseUrl,
      tagline: (input.lang === "en" ? en : lv).offerEmail.tagline,
      body,
      footer: [input.company ?? ""],
    }),
  };
}
