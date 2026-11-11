// Which channel brought a visitor that day, and which channels TV can cause
// (docs/TV_ANALYTICS_PLAN.md §8, owner 11 Nov 2026). TV is measured the way TV
// measurement tools do it: on traffic TV can drive (the TV link, direct and
// organic visits, searches for the brand), never on visits another channel paid
// for or sent (other Google Ads, Meta ads, social posts, e-mails, partners).

export type Channel = "direct" | "tv" | "google_brand" | "google" | "meta_ads" | "social" | "email" | "other";

export const CHANNELS: Channel[] = [
  "direct",
  "tv",
  "google_brand",
  "google",
  "meta_ads",
  "social",
  "email",
  "other",
];

/** The channels a TV spot can cause; the uplift and its baseline count only these. */
export const TV_ELIGIBLE: ReadonlySet<Channel> = new Set<Channel>(["direct", "tv", "google_brand"]);

export type LandingTags = {
  gclid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
};

const META = /^(facebook|fb|instagram|ig|meta|messenger|audience_network)$/;
const PAID = /^(cpc|ppc|paid|paid_social|paidsocial|ads?|display|cpm)$/;
const BRAND = /trilio/;

/** The channel of one ad or post landing (its tags), never null. */
export function landingChannel(l: LandingTags): Channel {
  const source = l.utmSource ?? "";
  const medium = l.utmMedium ?? "";
  if (medium === "tv") return "tv";
  if (medium === "email" || source === "email" || source === "newsletter") return "email";
  if (l.gclid || source === "google" || source === "adwords") {
    // A search for the brand, then its ad clicked: what TV makes people do.
    const brand = BRAND.test(`${l.utmTerm ?? ""} ${l.utmCampaign ?? ""}`);
    if (l.gclid || PAID.test(medium)) return brand ? "google_brand" : "google";
    return "other";
  }
  if (META.test(source)) return PAID.test(medium) ? "meta_ads" : "social";
  if (medium === "social") return "social";
  return "other";
}

/**
 * A visitor's channel that day: their first landing's, or "direct" without any
 * (a typed address, a bookmark, organic search: no tags arrive with those).
 */
export function visitorChannel(landings: (LandingTags & { at: Date })[]): Channel {
  if (landings.length === 0) return "direct";
  const first = [...landings].sort((a, b) => a.at.getTime() - b.at.getTime())[0]!;
  return landingChannel(first);
}

export type ChannelMix = Partial<Record<Channel, number>>;

/** Visitors per channel, for the mix shown next to the uplift. */
export function mixOf(channels: Channel[]): ChannelMix {
  const mix: ChannelMix = {};
  for (const c of channels) mix[c] = (mix[c] ?? 0) + 1;
  return mix;
}
