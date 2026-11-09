import { formatEur } from "@/i18n/format";
import en from "@/i18n/messages/en.json";
import lv from "@/i18n/messages/lv.json";
import { localizedPath, type UiLocale } from "@/i18n/routing";
import type { EmailMessage } from "@/services/notify/email";
import { emailImageUrl, offerProductName, subjectProductName } from "@/services/offers/compose";
import { button, centred, emailShell, hero, paragraph, productHero } from "@/services/offers/mail-layout";
import { fill } from "@/services/offers/texts";
import type { NotifyTarget } from "./requests";

// The receipt for an "Iegūt lētāk" request (docs/ALERTS_WITHOUT_CONFIRM_PLAN.md): what
// was asked, that it has started (a proposal where Trilio sources, price e-mails for
// 90 days), a button that opens the wishlist (and proves the address), and an unsubscribe.
// Same shell as the offer e-mails.

export function composeNotifyConfirmEmail(input: {
  to: string;
  lang: UiLocale;
  baseUrl: string;
  company?: string;
  token: string;
  target: NotifyTarget;
  /** The consent covered Trilio's offers: the e-mail promises a proposal, not only the price e-mails. */
  offers: boolean;
  /** The address had turned price e-mails off before: say so, and that the button turns them on. */
  alertsOff: boolean;
  unsubscribeUrl: string;
  /** RFC 8058 one-click address for List-Unsubscribe. */
  oneClickUrl: string;
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
  const off = input.alertsOff ? c.alertsOff : null;
  const text = [
    lead,
    [name, price].filter(Boolean).join("\n"),
    c.period,
    off,
    c.cta,
    fill(c.link, { url }),
    c.valid,
    `${c.notYou}\n${fill(c.unsubscribeLine, { url: input.unsubscribeUrl })}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const body = [
    hero(c.title),
    centred(lead),
    productHero(name, t.kind === "product" ? emailImageUrl(input.baseUrl, t.imageUrl) : null),
    price ? centred(price, "font-weight:600") : "",
    centred(c.period),
    off ? paragraph(off, "font-size:15px") : "",
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
      unsubscribe: { label: c.unsubscribe, url: input.unsubscribeUrl },
    }),
    headers: {
      "List-Unsubscribe": `<${input.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
