import en from "@/i18n/messages/en.json";
import lv from "@/i18n/messages/lv.json";
import type { UiLocale } from "@/i18n/routing";
import type { EmailMessage } from "@/services/notify/email";
import { button, centred, emailShell, hero, paragraph } from "@/services/offers/mail-layout";

// The magic-link e-mail ("Ienākt bez paroles"): the same branded shell as every other
// Trilio e-mail, in the language the person signs in with, instead of Auth.js's
// plain English default, which looked like phishing (owner, 9 Nov 2026).

export function composeSignInEmail(input: {
  to: string;
  url: string;
  lang: UiLocale;
  baseUrl: string;
  company?: string;
}): EmailMessage {
  const c = (input.lang === "en" ? en : lv).signInEmail;
  const tagline = (input.lang === "en" ? en : lv).offerEmail.tagline;
  const text = [c.intro, `${c.button}: ${input.url}`, c.valid, c.notYou].join("\n\n");
  const body = [
    hero(c.title),
    centred(c.intro),
    button(c.button, input.url),
    centred(c.valid, "font-size:14px"),
    paragraph(c.notYou, "font-size:14px"),
  ].join("");
  return {
    to: input.to,
    subject: c.subject,
    text,
    html: emailShell({
      lang: input.lang,
      title: c.subject,
      baseUrl: input.baseUrl,
      tagline,
      body,
      footer: [input.company ?? ""],
    }),
  };
}
