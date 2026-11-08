// Is a shop click a person following a link on a Trilio page? (docs/CLICK_QUALITY_PLAN.md)
//
// Browsers since 2020 send Sec-Fetch-* headers on every navigation: a click on a
// link in a Trilio page arrives as `same-origin` / `navigate` / `?1`. Scripts,
// link scanners and monitors that copy a browser's user agent mostly send none
// of them, or arrive from elsewhere. Nothing here identifies anyone: the
// signals are request metadata kept beside the click, never a device id.

import type { ClickSource } from "./click-source";

export const SUSPECT_REASONS = ["no_fetch_meta", "not_from_page", "no_page_view"] as const;
export type SuspectReason = (typeof SUSPECT_REASONS)[number];

/** What the request said about itself; stored with the click. */
export type ClickSignals = {
  /** Sec-Fetch-Site: same-origin, same-site, cross-site, none. */
  site: string | null;
  /** Sec-Fetch-Mode: navigate for a followed link. */
  mode: string | null;
  /** Sec-Fetch-User: true when a person activated the link. */
  user: boolean | null;
  /** The referring page's host only, never its path. */
  referrerHost: string | null;
  /** The first language of Accept-Language ("lv", "en-GB"). */
  lang: string | null;
};

const short = (v: string | null, max = 40) => (v ? v.trim().slice(0, max) || null : null);

export function signalsOf(headers: Headers): ClickSignals {
  let referrerHost: string | null = null;
  const ref = headers.get("referer");
  if (ref) {
    try {
      referrerHost = short(new URL(ref).host, 100);
    } catch {
      referrerHost = null;
    }
  }
  const user = headers.get("sec-fetch-user");
  return {
    site: short(headers.get("sec-fetch-site")),
    mode: short(headers.get("sec-fetch-mode")),
    user: user === null ? null : user === "?1",
    referrerHost,
    lang: short(headers.get("accept-language")?.split(",")[0]?.split(";")[0] ?? null, 20),
  };
}

const version = (ua: string, re: RegExp) => {
  const m = re.exec(ua);
  return m ? Number(m[1]) : null;
};

/**
 * A browser that always sends Sec-Fetch-* on navigation: Chromium 80+ (Chrome,
 * Edge, Opera, Samsung Internet), Firefox 90+, Safari 16.4+. Older or unknown
 * agents are given the benefit of the doubt.
 */
export function sendsFetchMetadata(userAgent: string | null | undefined): boolean {
  const ua = userAgent ?? "";
  const firefox = version(ua, /(?:Firefox|FxiOS)\/(\d+)/);
  if (firefox !== null) return firefox >= 90;
  // Chrome on iOS is Safari underneath: judge it by the iOS version below.
  const chrome = /iPhone|iPad|iPod/.test(ua) ? null : version(ua, /Chrome\/(\d+)/);
  if (chrome !== null) return chrome >= 80;
  const safari = /Version\/(\d+)\.(\d+)/.exec(ua);
  const ios = /OS (\d+)_(\d+)/.exec(ua);
  const pair = safari ?? (/iPhone|iPad|iPod/.test(ua) ? ios : null);
  if (pair && /Safari\//.test(ua)) {
    const [major, minor] = [Number(pair[1]), Number(pair[2])];
    return major > 16 || (major === 16 && minor >= 4);
  }
  return false;
}

/**
 * Why a click does not look like a person on a Trilio page, or null when it
 * does. Every named source is a link inside a Trilio page. First matching reason wins: missing metadata from a browser that always
 * sends it, a link from a page that arrived from elsewhere, no page view by the
 * same visitor that day (the page beacon needs JavaScript and a visible page).
 */
export function clickSuspicion(input: {
  userAgent: string | null | undefined;
  signals: ClickSignals;
  source: ClickSource | null;
  pageViewed: boolean;
}): SuspectReason | null {
  const { signals } = input;
  if (!signals.site && sendsFetchMetadata(input.userAgent)) return "no_fetch_meta";
  if (signals.site && signals.site !== "same-origin" && input.source !== null) return "not_from_page";
  if (!input.pageViewed) return "no_page_view";
  return null;
}

/**
 * Whether any request (a page view beacon, a results page, a button's server
 * call) does not look like a person's browser (docs/CLICK_QUALITY_PLAN.md §6):
 * a browser that always sends fetch metadata sent none ("no_fetch_meta"), or a
 * page's own beacon came from another site ("not_from_page"). Null when it
 * does. A visitor with such a request is left out of that day's figures.
 */
export function requestSuspicion(
  userAgent: string | null | undefined,
  signals: Pick<ClickSignals, "site">,
  kind: "page" | "beacon" = "page",
): SuspectReason | null {
  if (!signals.site && sendsFetchMetadata(userAgent)) return "no_fetch_meta";
  if (kind === "beacon" && signals.site && signals.site !== "same-origin") return "not_from_page";
  return null;
}
