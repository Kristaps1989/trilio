import en from "@/i18n/messages/en.json";
import lv from "@/i18n/messages/lv.json";
import type { UiLocale } from "@/i18n/routing";
import type { WishlistTexts } from "@/services/wishlist/job";

// Copy for background jobs in the recipient's language (users.locale), read
// straight from the message files so the jobs work from the CLI (no request
// context) as well as from routes. Only simple {placeholder} interpolation is
// needed here.

const MESSAGES = { lv, en } as const;

function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}

export function wishlistTexts(lang: UiLocale = "lv"): WishlistTexts {
  const { email } = MESSAGES[lang];
  return {
    subjectOne: (v) => fill(email.wishlistSubjectOne, v),
    subjectMany: (v) => fill(email.wishlistSubjectMany, v),
    productLine: (v) => fill(email.wishlistProductLine, v),
    searchLine: (v) => fill(email.wishlistSearchLine, v),
    view: email.wishlistView,
    unsubscribe: email.wishlistUnsubscribe,
  };
}
