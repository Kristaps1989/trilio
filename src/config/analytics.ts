/** GA4 measurement id from GA_MEASUREMENT_ID, or null when analytics is off. Read at runtime. */
export function analyticsId(env: Record<string, string | undefined> = process.env): string | null {
  const id = (env.GA_MEASUREMENT_ID ?? "").trim();
  return /^G-[A-Z0-9]{4,20}$/.test(id) ? id : null;
}

/** Google Ads tag id ("AW-…") from GOOGLE_ADS_TAG_ID, or null. Loads only after consent, like GA4. */
export function adsTagId(env: Record<string, string | undefined> = process.env): string | null {
  const id = (env.GOOGLE_ADS_TAG_ID ?? "").trim();
  return /^AW-\d{6,15}$/.test(id) ? id : null;
}

export type AdsTag = {
  id: string;
  /** "AW-…/label" conversion targets from Google Ads → Goals → Conversions; null when not set up. */
  shopClick: string | null;
  save: string | null;
};

/** The Ads tag with its conversion targets. A bare label is completed with the tag id. */
export function adsTag(env: Record<string, string | undefined> = process.env): AdsTag | null {
  const id = adsTagId(env);
  if (!id) return null;
  const target = (raw: string | undefined): string | null => {
    const v = (raw ?? "").trim();
    if (/^AW-\d{6,15}\/[A-Za-z0-9_-]{4,40}$/.test(v)) return v;
    if (/^[A-Za-z0-9_-]{4,40}$/.test(v)) return `${id}/${v}`;
    return null;
  };
  return {
    id,
    shopClick: target(env.GOOGLE_ADS_CONVERSION_SHOP_CLICK),
    save: target(env.GOOGLE_ADS_CONVERSION_SAVE),
  };
}

/** The Google Ads conversion for a GA4 event, if it is one and its label is set. */
export function adsConversionFor(event: string, ads: AdsTag | null): string | null {
  if (!ads) return null;
  if (event === "select_offer") return ads.shopClick;
  if (event === "save_item") return ads.save;
  return null;
}

/** Meta Pixel (dataset) id from META_PIXEL_ID, or null. Loads only after consent (docs/META_ADS_PLAN.md §2). */
export function metaPixelId(env: Record<string, string | undefined> = process.env): string | null {
  const id = (env.META_PIXEL_ID ?? "").trim();
  return /^\d{10,20}$/.test(id) ? id : null;
}

/** True when any measuring tag is configured: the consent banner and its footer link are shown. */
export function trackingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !!(analyticsId(env) || adsTagId(env) || metaPixelId(env));
}

/** Hosts GA4 sends data to; added to the CSP only when analytics is on. */
export const ANALYTICS_HOSTS = [
  "https://www.googletagmanager.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
] as const;

/** Hosts the Google Ads tag uses (Google's CSP guide for gtag.js); only when the Ads tag is on. */
export const ADS_HOSTS = [
  "https://www.googletagmanager.com",
  "https://www.googleadservices.com",
  "https://googleads.g.doubleclick.net",
  "https://ad.doubleclick.net",
  "https://pagead2.googlesyndication.com",
  "https://www.google.com",
  "https://www.google.lv",
] as const;

/** Hosts the Meta Pixel loads its script from and sends events to; only when the Pixel is on. */
export const META_HOSTS = ["https://connect.facebook.net", "https://www.facebook.com"] as const;

/** CSP hosts for whichever tags are configured, without duplicates. */
export function trackingHosts(env: Record<string, string | undefined> = process.env): string[] {
  return [
    ...new Set([
      ...(analyticsId(env) ? ANALYTICS_HOSTS : []),
      ...(adsTagId(env) ? ADS_HOSTS : []),
      ...(metaPixelId(env) ? META_HOSTS : []),
    ]),
  ];
}
