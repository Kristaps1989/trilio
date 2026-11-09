// Decoding Go3's FreeWheel site section (owner's "Decoding FreeWheel Site Section Name
// for Go3 Go", 9 Nov 2026; docs/TV_PIXEL_BEST_PRACTICE.md §2.1): DAI_<device>_<environment>_<placement>,
// e.g. DAI_smarttv_other_PR_TV3_Life_LV_HD_HVC is a Smart TV watching TV3 Life live (the LV feed).
// The feed suffix is the channel's feed, not where the viewer is.

export type ContentType = "LIVE" | "CATCHUP" | "VOD";
export type Screen = "tv" | "desktop" | "mobile" | "other";

export type Go3Section = {
  device: string;
  environment: string;
  type: ContentType;
  /** The live channel ("TV3 Life"); null for catch-up and on-demand. */
  channel: string | null;
  screen: Screen;
  section: string;
};

/** The channel of a live placement: PR_TV3_Life_LV_HD_HVC → "TV3 Life". */
export function prettyChannel(placement: string): string {
  const c = placement
    .replace(/^PR_/i, "")
    .replace(/_HVC$/i, "")
    .replace(/_HD(?=_|$)/gi, "")
    .replace(/_(LV|EE|LT)(?=_|$)/gi, "")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b3plus\b/i, "3+");
  return c || "Unattributed";
}

/** Television screen (Smart TV, Apple TV, Roku), desktop web, or mobile app. */
export function screenOf(device: string): Screen {
  if (device === "smarttv" || device === "tvos" || device === "roku") return "tv";
  if (device === "browser") return "desktop";
  if (device === "android" || device === "ios") return "mobile";
  return "other";
}

/** A device's display name: Smart TV, Browser, Android, iOS; an unknown one capitalised. */
export function deviceLabel(device: string): string {
  const known: Record<string, string> = {
    smarttv: "Smart TV",
    browser: "Browser",
    android: "Android",
    ios: "iOS",
    tvos: "Apple TV",
    roku: "Roku",
  };
  return known[device] ?? (device ? device[0]!.toUpperCase() + device.slice(1) : "Other");
}

export function parseSection(raw: string | null | undefined): Go3Section {
  const section = String(raw ?? "").trim();
  const t = section.split("_");
  let device = "other";
  let environment = "other";
  let rest = section;
  if (t.length >= 4 && /^DAI$/i.test(t[0]!)) {
    device = t[1]!.toLowerCase();
    environment = t[2]!.toLowerCase();
    rest = t.slice(3).join("_");
  } else if (t.length >= 3) {
    device = t[0]!.toLowerCase();
    environment = t[1]!.toLowerCase();
    rest = t.slice(2).join("_");
  }
  const type: ContentType = /catchup/i.test(rest) ? "CATCHUP" : /vod/i.test(rest) ? "VOD" : "LIVE";
  return {
    device,
    environment,
    type,
    channel: type === "LIVE" ? prettyChannel(rest) : null,
    screen: screenOf(device),
    section,
  };
}

/** Whether a value looks like a Go3 site section (DAI_…), to choose it over another field. */
export const isGo3Section = (v: string | null | undefined): boolean => !!v && /^DAI_/i.test(v.trim());
