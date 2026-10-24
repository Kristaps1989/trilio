import { getRequestConfig } from "next-intl/server";
import { setActiveLocale } from "./active";
import { currentMarket } from "./market";
import { isUiLocale, routing, type UiLocale } from "./routing";

// The UI language comes from the URL (src/i18n/routing.ts): the market's own
// language without a prefix, English under /en. Locale files for lt and et
// are scaffolded from lv (scripts/scaffold-locales.py) and carry
// "__status": "pending_translation"; any key missing from a locale falls
// back to Latvian, so a partial translation never breaks a page.

export const locales = ["lv", "lt", "et", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "lv";

type Messages = Record<string, unknown>;

function deepMerge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === "__status") continue;
    const b = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object"
        ? deepMerge(b as Messages, v as Messages)
        : v;
  }
  return out;
}

export async function loadMessages(locale: Locale): Promise<Messages> {
  const lv = (await import("./messages/lv.json")).default as Messages;
  if (locale === "lv") return lv;
  const over = (await import(`./messages/${locale}.json`)).default as Messages;
  return deepMerge(lv, over);
}

/** Messages for a UI locale: the market's own language for "lv", English for "en". */
export function messagesLocale(ui: UiLocale): Locale {
  return ui === "en" ? "en" : currentMarket().locale;
}

/** The html lang of a UI locale. */
export function htmlLang(ui: UiLocale): string {
  return ui === "en" ? "en" : currentMarket().locale;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: UiLocale = isUiLocale(requested) ? requested : routing.defaultLocale;
  setActiveLocale(locale);
  const market = currentMarket().locale;
  return {
    locale,
    messages: await loadMessages(messagesLocale(locale)),
    timeZone: market === "lt" ? "Europe/Vilnius" : market === "et" ? "Europe/Tallinn" : "Europe/Riga",
  };
});
