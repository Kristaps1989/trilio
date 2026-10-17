import { getRequestConfig } from "next-intl/server";
import { currentMarket } from "./market";

// The UI language follows the market (LV → lv, LT → lt, EE → et). Locale
// files for lt and et are scaffolded from lv (scripts/scaffold-locales.py)
// and carry "__status": "pending_translation"; any key missing from a
// locale falls back to Latvian so a partial translation never breaks a page.

export const locales = ["lv", "lt", "et"] as const;
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

export default getRequestConfig(async () => {
  const locale = currentMarket().locale;
  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: locale === "lt" ? "Europe/Vilnius" : locale === "et" ? "Europe/Tallinn" : "Europe/Riga",
  };
});
