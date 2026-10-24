import { cache } from "react";
import { isUiLocale, type UiLocale } from "./routing";

// The request's UI language for code that formats without a translator
// (src/i18n/format.ts). Server components: every page and layout under
// [locale] calls initLocale(params) (src/i18n/init.ts) first, which stores
// the locale for the request (React cache). Client components pass
// useLocale() to the formatters explicitly; background jobs pass the
// recipient's language. Without either, Latvian.

const store = cache(() => ({ locale: "lv" as UiLocale }));

export function activeLocale(): UiLocale {
  try {
    return store().locale;
  } catch {
    return "lv";
  }
}

export function setActiveLocale(locale: unknown): UiLocale {
  const l: UiLocale = isUiLocale(locale) ? locale : "lv";
  try {
    store().locale = l;
  } catch {
    // Outside a request: nothing to remember.
  }
  return l;
}
