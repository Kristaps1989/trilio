// "Iegūt lētāk" without an account (docs/PRICE_NOTIFY_PLAN.md):
// the rules that need no database. One yes covers Trilio's own offers only
// where the text shown said so, and that text is stored with its version.

/** Bump when the wording in notify.body* changes, so every stored consent names the text it saw. */
export const CONSENT_VERSION = "2026-11-09.2";

/**
 * From this consent version on, the text shown says that one proposal for the product
 * is e-mailed to the address entered, confirmed or not (docs/REQUEST_OFFER_PLAN.md).
 * Requests that saw an older text were told nothing would come before confirming.
 */
export const OFFER_WITHOUT_CONFIRM_FROM = "2026-11-09";

/**
 * From this consent version on, entering the e-mail is the consent (lawyer and owner,
 * 9 Nov 2026; docs/ALERTS_WITHOUT_CONFIRM_PLAN.md): the price e-mails start at once,
 * for 90 days, and every e-mail can be unsubscribed. Older requests keep the promise
 * they were made under (nothing ongoing before the click).
 */
export const ACTIVE_ON_REQUEST_FROM = "2026-11-09.2";

/** Price e-mails run this long from the request (or the last renewal). */
export const ALERT_DAYS = 90;
/** The e-mail that asks whether to continue goes this many days before the end. */
export const RENEW_NOTICE_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;

/** When the price e-mails for an item saved or renewed now end. */
export function alertsUntilFrom(now: Date): Date {
  return new Date(now.getTime() + ALERT_DAYS * DAY_MS);
}

export type AlertPhase = "active" | "notice" | "expired";

/** Running, due for the "turpināt?" e-mail (once), or ended. */
export function alertPhase(item: { alertsUntil: Date; renewalSentAt: Date | null }, now: Date): AlertPhase {
  const left = item.alertsUntil.getTime() - now.getTime();
  if (left <= 0) return "expired";
  if (left <= RENEW_NOTICE_DAYS * DAY_MS && !item.renewalSentAt) return "notice";
  return "active";
}

/** Whether a request made with this consent text starts the price e-mails without a click. */
export function activeOnRequest(consent: string): boolean {
  const v = consentVersion(consent);
  return !!v && v >= ACTIVE_ON_REQUEST_FROM;
}

export const REQUEST_TTL_MS = 7 * 24 * 3600 * 1000;
/** After confirming, the same link signs the person in once, for this long. */
export const SIGN_IN_TTL_MS = 30 * 60 * 1000;
export const MAX_PER_VISITOR_PER_DAY = 5;
export const MAX_PER_EMAIL_PER_DAY = 3;

const EMAIL = /^[^@\s<>"']{1,64}@[^@\s<>"']{1,190}\.[^@\s<>"'.]{2,24}$/;

/** Lower-cased and trimmed, or null when it is not an address we would send to. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

export type NotifyKind = "product" | "search";

/**
 * The message key of the consent text shown, and whether it covers Trilio's offers.
 * Only a product can be asked from a partner (owner, 31 Oct 2026): a saved search
 * is a watch for a cheaper option, so its consent never covers offers.
 */
export function consentFor(kind: NotifyKind, sourcing: boolean): { key: string; offers: boolean } {
  if (kind === "search") return { key: `notify.bodySearch@${CONSENT_VERSION}`, offers: false };
  return { key: `notify.${sourcing ? "body" : "bodyPlain"}@${CONSENT_VERSION}`, offers: sourcing };
}

/** A same-site path to return to, or null (no other hosts, no protocol-relative URLs). */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 1000) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

export type RateDecision = "ok" | "too_many";

export function rateLimit(counts: { visitor: number; email: number }): RateDecision {
  return counts.visitor >= MAX_PER_VISITOR_PER_DAY || counts.email >= MAX_PER_EMAIL_PER_DAY
    ? "too_many"
    : "ok";
}

/** Whether a request may still be confirmed, and whether its link may still sign in. */
export function requestState(
  r: { createdAt: Date; confirmedAt: Date | null; signedInAt: Date | null },
  now: Date,
): { confirmable: boolean; canSignIn: boolean } {
  const fresh = now.getTime() - r.createdAt.getTime() <= REQUEST_TTL_MS;
  const confirmable = r.confirmedAt ? true : fresh;
  const canSignIn =
    !!r.confirmedAt && !r.signedInAt && now.getTime() - r.confirmedAt.getTime() <= SIGN_IN_TTL_MS;
  return { confirmable, canSignIn };
}

/** The version part of a stored consent key ("notify.body@2026-11-09.2" → "2026-11-09.2"). */
export function consentVersion(key: string): string | null {
  const m = /@(\d{4}-\d{2}-\d{2}(?:\.\d+)?)$/.exec(key);
  return m ? m[1]! : null;
}

export type OfferableReason = "ok" | "search" | "no_offers" | "old_text" | "confirmed" | "expired";

/**
 * Whether Trilio may e-mail one proposal for this request without its address
 * being confirmed (docs/REQUEST_OFFER_PLAN.md §1): a product, a text that covered
 * Trilio's offers and said a proposal would come, not confirmed (a confirmed
 * request has an account and goes the usual way), still kept (7 days).
 */
export function requestOfferable(
  r: { kind: string; offers: boolean; consent: string; createdAt: Date; confirmedAt: Date | null },
  now: Date,
): OfferableReason {
  if (r.kind !== "product") return "search";
  if (!r.offers) return "no_offers";
  if (r.confirmedAt) return "confirmed";
  const v = consentVersion(r.consent);
  if (!v || v < OFFER_WITHOUT_CONFIRM_FROM) return "old_text";
  if (now.getTime() - r.createdAt.getTime() > REQUEST_TTL_MS) return "expired";
  return "ok";
}
