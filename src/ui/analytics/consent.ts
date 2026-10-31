// Visitor's analytics choice, kept in a first-party cookie (strictly
// necessary: it only records the choice itself). No choice yet → "unset".

export type Consent = "granted" | "denied" | "unset";

export const CONSENT_COOKIE = "trilio_consent";
export const CONSENT_CHANGED = "trilio:consent-changed";
export const CONSENT_OPEN = "trilio:consent-open";

export function readConsent(cookie: string = document.cookie): Consent {
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=(granted|denied)`));
  return (m?.[1] as Consent | undefined) ?? "unset";
}

export function writeConsent(value: "granted" | "denied"): void {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  // About six months, then we ask again.
  document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${180 * 24 * 3600}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(CONSENT_CHANGED));
}

/** Removes the Google cookies (`_ga`, `_ga_<id>`, Google Ads `_gcl_*`) and Meta's (`_fbp`, `_fbc`) after consent is withdrawn. */
export function deleteAnalyticsCookies(): void {
  const names = document.cookie
    .split(";")
    .map((c) => c.split("=")[0]!.trim())
    .filter(
      (n) => n === "_ga" || n.startsWith("_ga_") || n.startsWith("_gcl_") || n === "_fbp" || n === "_fbc",
    );
  const host = location.hostname;
  const domains = ["", host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
  for (const name of names) {
    for (const d of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/${d ? `; Domain=${d}` : ""}`;
    }
  }
}
