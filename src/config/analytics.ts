/** GA4 measurement id from GA_MEASUREMENT_ID, or null when analytics is off. Read at runtime. */
export function analyticsId(env: Record<string, string | undefined> = process.env): string | null {
  const id = (env.GA_MEASUREMENT_ID ?? "").trim();
  return /^G-[A-Z0-9]{4,20}$/.test(id) ? id : null;
}

/** Hosts GA4 sends data to; added to the CSP only when analytics is on. */
export const ANALYTICS_HOSTS = [
  "https://www.googletagmanager.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
] as const;
