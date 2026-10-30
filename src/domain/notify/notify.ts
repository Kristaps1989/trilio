// "Paziņot, kad cena samazināsies" without an account (docs/PRICE_NOTIFY_PLAN.md):
// the rules that need no database. One yes covers Trilio's own offers only
// where the text shown said so, and that text is stored with its version.

/** Bump when the wording in notify.body* changes, so every stored consent names the text it saw. */
export const CONSENT_VERSION = "2026-10-30";

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

/** The message key of the consent text shown, and whether it covers Trilio's offers. */
export function consentFor(kind: NotifyKind, sourcing: boolean): { key: string; offers: boolean } {
  const base = kind === "product" ? "notify.body" : "notify.bodySearch";
  return { key: `${sourcing ? base : `${base}Plain`}@${CONSENT_VERSION}`, offers: sourcing };
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
