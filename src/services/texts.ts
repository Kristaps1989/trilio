import lv from "@/i18n/messages/lv.json";
import type { BillingTexts } from "@/services/billing/job";
import type { WishlistTexts } from "@/services/wishlist/job";

// Latvian copy for background jobs, read straight from the message file so
// the jobs work from the CLI (no request context) as well as from routes.
// Only simple {placeholder} interpolation is needed here.

function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}

const email = lv.email;
const wishlist = lv.wishlist;

export function billingTexts(): BillingTexts {
  return {
    receiptSubject: (v) => fill(email.receiptSubject, v),
    receiptBody: (v) => fill(email.receiptBody, v),
    failedSubject: email.failedSubject,
    failedBody: (v) => fill(email.failedBody, v),
    expired: wishlist.expired,
  };
}

export function wishlistTexts(): WishlistTexts {
  return {
    subjectOne: (v) => fill(email.wishlistSubjectOne, v),
    subjectMany: (v) => fill(email.wishlistSubjectMany, v),
    productLine: (v) => fill(email.wishlistProductLine, v),
    searchLine: (v) => fill(email.wishlistSearchLine, v),
    view: email.wishlistView,
  };
}
