import { createHash } from "node:crypto";
import { isGo3Section } from "./go3-section";

// What a TV pixel request carries, read without keeping an address
// (docs/TV_PIXEL_BEST_PRACTICE.md). With server-side ad insertion the pixel is
// requested by the platform's ad server, not by the TV, so the request's own
// address is the ad server's. The household's address can still arrive three
// ways, in order of trust: a macro the ad server fills (`?ip=`), a header it
// adds for trackers (`X-Device-IP`), or an X-Forwarded-For chain it extends.

export type PixelParams = {
  vid: string | null;
  ip: string | null;
  ts: string | null;
  /** Creative: its name when given (`crn`), else its id (`cr`). */
  cr: string | null;
  ch: string | null;
  pos: string | null;
  /**
   * The site section name (`ss`, FreeWheel's #{section.title}), the "Site Section Name" of
   * Go3's reports: DAI_<device>_<environment>_<placement>. The custom id (`csid`,
   * #{section.customId}) is the fallback when the name does not come.
   */
  csid: string | null;
  /** Device type (`dt`, FreeWheel's standard attribute). */
  dt: string | null;
  /** The viewer's device user agent (`ua`), when the ad server passes it. */
  ua: string | null;
  /** The viewer's country (`co`, FreeWheel's #{request.country}): the CSID's feed suffix is not it. */
  country: string | null;
  /** The device opted out of ad tracking (`lat=1`, #{request.deviceOptOut}): counted, never followed. */
  optOut: boolean;
  /** The spot's length in seconds (`dur`, #{ad.creative.rendition.duration}). */
  dur: string | null;
  /** The programme the spot ran in: the series (`pg`), else the asset title (`ast`). */
  program: string | null;
  /** Genre (`gn`, #{sa.genre}) and daypart (`dp`, #{sa.contentdaypart}). */
  genre: string | null;
  daypart: string | null;
  /** The placement (`pl`, #{ad.placement.name}): several placements under one campaign address. */
  placement: string | null;
  /** The device id's type (`idt`, #{request.deviceIdType("iab")}): tifa, rida, aaid, idfa… */
  idType: string | null;
  grp: "ad" | "control";
};

/**
 * An unfilled macro counts as absent: FreeWheel's "#{…}" and its encoded forms
 * "#e{…}", "#s{…}", "#2{…}", and other servers' "${…}", "[…]", "%%…%%", "{…}".
 */
const UNFILLED = /#[es2]?\{|\$\{|^\[.*\]$|%%|^\{.*\}$/;

/** A short label for a creative, channel or position: letters, digits and a little punctuation, at most 60 characters. */
export function cleanValue(raw: string | null | undefined, max = 60): string | null {
  const v = (raw ?? "").trim();
  if (!v || UNFILLED.test(v)) return null;
  const clean = v
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ._:/+-]/gu, "")
    .trim()
    .slice(0, max);
  return clean || null;
}

/**
 * The site section: the name (`ss`, #{section.title}) first, as Go3's reports use it;
 * the custom id (`csid`, #{section.customId}) only when it, not the name, has the
 * DAI_<device>_<environment>_<placement> form (go3-section.ts), or when no name came.
 */
function section(ss: string | null, csid: string | null): string | null {
  if (isGo3Section(ss)) return ss;
  if (isGo3Section(csid)) return csid;
  return ss ?? csid;
}

export function pixelParams(params: URLSearchParams): PixelParams {
  const raw = (k: string) => {
    const v = params.get(k)?.trim() ?? "";
    return v && !UNFILLED.test(v) ? v : null;
  };
  const grp = (raw("grp") ?? "").toLowerCase();
  return {
    vid: raw("vid"),
    ip: raw("ip"),
    ts: raw("ts"),
    cr: cleanValue(params.get("crn")) ?? cleanValue(params.get("cr")),
    ch: cleanValue(params.get("ch")),
    pos: cleanValue(params.get("pos"), 20)?.toLowerCase() ?? null,
    csid: section(cleanValue(params.get("ss"), 80), cleanValue(params.get("csid"), 80)),
    dt: cleanValue(params.get("dt"), 40),
    ua: raw("ua")?.slice(0, 400) ?? null,
    country: cleanValue(params.get("co"), 3)?.toUpperCase() ?? null,
    optOut: raw("lat") === "1",
    dur: /^\d{1,4}(\.\d+)?$/.test(raw("dur") ?? "") ? String(Math.round(Number(raw("dur")))) : null,
    program: cleanValue(params.get("pg"), 80) ?? cleanValue(params.get("ast"), 80),
    genre: cleanValue(params.get("gn"), 60),
    daypart: cleanValue(params.get("dp"), 40),
    placement: cleanValue(params.get("pl"), 80),
    idType: cleanValue(params.get("idt"), 20)?.toLowerCase() ?? null,
    grp: grp === "control" || grp === "holdout" || grp === "psa" ? "control" : "ad",
  };
}

/**
 * The ad event's own time from `?ts=` (epoch seconds or milliseconds, or ISO 8601),
 * when it lies between two hours before and five minutes after the request: an
 * ad server may batch its beacons. Otherwise null, and the request time is used.
 */
export function eventTime(raw: string | null, now: Date): Date | null {
  if (!raw) return null;
  let ms: number;
  if (/^\d{9,13}$/.test(raw)) ms = raw.length <= 10 ? Number(raw) * 1000 : Number(raw);
  else ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const d = ms - now.getTime();
  return d >= -2 * 3600_000 && d <= 5 * 60_000 ? new Date(ms) : null;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function v4(ip: string): number[] | null {
  const m = IPV4.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** Expands an IPv6 address to eight hextets, or null. */
function v6(ip: string): string[] | null {
  if (!ip.includes(":") || !/^[0-9a-f:.]+$/i.test(ip)) return null;
  const [head, tail, extra] = ip.toLowerCase().split("::");
  if (extra !== undefined) return null;
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (tail === undefined && h.length !== 8) return null;
  const fill = tail !== undefined ? Array(8 - h.length - t.length).fill("0") : [];
  const all = [...h, ...fill, ...t];
  if (all.length !== 8 || all.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return all.map((x) => x.replace(/^0+(?=.)/, ""));
}

/** Strips a port and IPv6 brackets ("[2001:db8::1]:443", "1.2.3.4:5678"). */
function bare(raw: string): string {
  const s = raw.trim();
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracket) return bracket[1]!;
  const port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s);
  return port ? port[1]! : s;
}

/**
 * The household key of a public address: an IPv4 address as is, an IPv6
 * address cut to its /64 (one home's network; phones change the rest). Private,
 * loopback, link-local, carrier-grade NAT and documentation ranges are not a household.
 */
export function householdKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ip = bare(raw);
  const a = v4(ip);
  if (a) {
    const [x, y] = [a[0]!, a[1]!];
    const isPrivate =
      x === 0 ||
      x === 10 ||
      x === 127 ||
      (x === 100 && y >= 64 && y <= 127) ||
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 192 && y === 0) ||
      (x === 198 && (y === 18 || y === 19)) ||
      x >= 224;
    return isPrivate ? null : a.join(".");
  }
  const b = v6(ip);
  if (b) {
    const first = parseInt(b[0]!, 16);
    // Global unicast only (2000::/3), and not documentation (2001:db8::/32).
    if (first < 0x2000 || first > 0x3fff || (b[0] === "2001" && b[1] === "db8")) return null;
    return `${b.slice(0, 4).join(":")}::/64`;
  }
  return null;
}

/** X-Forwarded-For as a list of addresses, first (the claimed client) to last. */
export function forwardedChain(xff: string | null | undefined): string[] {
  return (xff ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export type AddressSource = "macro" | "header" | "forwarded";

/**
 * The household's address for this impression, and where it came from: the
 * `?ip=` macro, an `X-Device-IP` header, or the first X-Forwarded-For hop when
 * the chain has at least two (someone forwarded on the viewer's behalf). Null
 * when none is a public address.
 */
export function householdAddress(input: {
  macroIp: string | null;
  deviceIp: string | null;
  xff: string | null;
}): { key: string; source: AddressSource } | null {
  const macro = householdKey(input.macroIp);
  if (macro) return { key: macro, source: "macro" };
  const header = householdKey(input.deviceIp);
  if (header) return { key: header, source: "header" };
  const chain = forwardedChain(input.xff);
  if (chain.length >= 2) {
    const first = householdKey(chain[0]);
    if (first) return { key: first, source: "forwarded" };
  }
  return null;
}

/** The headers an ad server may add for trackers; their presence is counted, never their value. */
export const DIAGNOSTIC_HEADERS = [
  "x-forwarded-for",
  "forwarded",
  "x-real-ip",
  "x-device-ip",
  "x-device-user-agent",
  "x-device-referer",
  "x-device-referrer",
  "x-client-ip",
  "true-client-ip",
  "x-original-forwarded-for",
] as const;

/**
 * A TV, set-top box or app's family from a user agent, coarse enough to say
 * nothing about anyone: "Samsung Tizen", "LG webOS", "Android TV", "Go3 app",
 * or for server software "server: okhttp" and the like.
 */
export function tvClientFamily(ua: string | null | undefined): string {
  const s = ua ?? "";
  if (!s) return "—";
  const rules: [RegExp, string][] = [
    [/Go3/i, "Go3 app"],
    [/Tizen/i, "Samsung Tizen"],
    [/Web0S|webOS|NetCast/i, "LG webOS"],
    [/AFT[A-Z]/, "Amazon Fire TV"],
    [/Roku/i, "Roku"],
    [/AppleTV|tvOS/i, "Apple TV"],
    [/Android.*(TV|BRAVIA|AndroidTV)|Android TV|GoogleTV|Chromecast/i, "Android TV"],
    [/HbbTV/i, "HbbTV"],
    [/SmartTV|SMART-TV|SmartHub/i, "Smart TV"],
    [/VIDAA|Hisense/i, "Hisense VIDAA"],
    [/PhilipsTV|Saphi/i, "Philips"],
    [/STB|Set-?Top|Kaonmedia|Arris|Technicolor/i, "Set-top box"],
    [/iPhone|iPad/, "iOS"],
    [/Android/, "Android"],
    [/okhttp/i, "server: okhttp"],
    [/Go-http-client/i, "server: Go"],
    [/Apache-HttpClient|Java\//i, "server: Java"],
    [/python|aiohttp|requests/i, "server: Python"],
    [/curl|wget/i, "server: curl"],
    [/node-fetch|axios|undici|Node\.js/i, "server: Node"],
    [/FreeWheel|fwmrm/i, "server: FreeWheel"],
    [/Windows/, "Windows"],
    [/Macintosh|Mac OS X/, "macOS"],
    [/Linux/, "Linux"],
  ];
  for (const [re, name] of rules) if (re.test(s)) return name;
  return "Cits";
}

/** A household's hash for one campaign: the address never leaves this function. */
export function householdHash(salt: string, key: string): string {
  return createHash("sha256").update(`${salt}|hh|${key}`).digest("base64url").slice(0, 22);
}

/** An address's hash for the diagnostic's distinct counts, keyed by day so they never link across days. */
export function addressHash(salt: string, day: string, address: string): string {
  return createHash("sha256").update(`${salt}|addr|${day}|${address}`).digest("base64url").slice(0, 16);
}

/* ---------- household view-through (docs/TV_PIXEL_BEST_PRACTICE.md §2.2–2.3) ---------- */

export const DIRECT_WINDOW_MS = 20 * 60_000;
export const WEEK_WINDOW_MS = 7 * 86_400_000;

export type Exposure = { household: string; at: Date; grp: "ad" | "control" };
export type HouseholdVisit = { household: string; at: Date };

export type HouseholdFigures = {
  /** Households exposed (ad group). */
  exposed: number;
  /** Of them, with a visit 0–20 minutes after one of their exposures. */
  direct: number;
  /** Of them, with a visit within 7 days after their first exposure. */
  week: number;
  /** The same for the holdout. */
  control: number;
  controlDirect: number;
  controlWeek: number;
};

/**
 * Exposed households and how many came to the site, per group. A visit counts
 * from the exposure's minute on (the minute itself included: the pixel and the
 * visit are both truncated to minutes) and never before it.
 */
export function householdFigures(exposures: Exposure[], visits: HouseholdVisit[]): HouseholdFigures {
  const seen = new Map<string, number[]>();
  for (const v of visits) {
    const list = seen.get(v.household) ?? [];
    list.push(v.at.getTime());
    seen.set(v.household, list);
  }
  for (const list of seen.values()) list.sort((a, b) => a - b);
  const groups = { ad: new Map<string, number[]>(), control: new Map<string, number[]>() };
  for (const e of exposures) {
    const g = groups[e.grp];
    const list = g.get(e.household) ?? [];
    list.push(e.at.getTime());
    g.set(e.household, list);
  }
  const tally = (g: Map<string, number[]>) => {
    let direct = 0;
    let week = 0;
    for (const [hh, times] of g) {
      const v = seen.get(hh);
      if (!v) continue;
      if (times.some((t) => v.some((x) => x >= t && x - t <= DIRECT_WINDOW_MS))) direct++;
      const first = Math.min(...times);
      if (v.some((x) => x >= first && x - first <= WEEK_WINDOW_MS)) week++;
    }
    return { n: g.size, direct, week };
  };
  const ad = tally(groups.ad);
  const control = tally(groups.control);
  return {
    exposed: ad.n,
    direct: ad.direct,
    week: ad.week,
    control: control.n,
    controlDirect: control.direct,
    controlWeek: control.week,
  };
}

/**
 * The relative lift of the exposed households' visit rate over the holdout's,
 * with a 95 % interval from the two proportions (normal approximation); null
 * when either group is empty or the holdout never visited.
 */
export function holdoutLift(
  exposed: number,
  visited: number,
  control: number,
  controlVisited: number,
): { lift: number; low: number; high: number } | null {
  if (exposed <= 0 || control <= 0 || controlVisited <= 0) return null;
  const p1 = visited / exposed;
  const p0 = controlVisited / control;
  const se = Math.sqrt((p1 * (1 - p1)) / exposed + (p0 * (1 - p0)) / control);
  const d = p1 - p0;
  const r = (x: number) => Math.round((x / p0) * 1000) / 1000;
  return { lift: r(d), low: r(d - 1.96 * se), high: r(d + 1.96 * se) };
}

/**
 * Which address source the household figures can rest on, from a day's
 * diagnostic: a macro or a device header whenever present; forwarded
 * addresses only when they are many (at least a third of the devices
 * reached), so an ad server's few addresses are never taken for homes.
 */
export function usableSource(diag: {
  reach: number;
  distinct: Partial<Record<"macro" | "device" | "xff0", number>>;
  forwarded: number;
  impressions: number;
}): { source: AddressSource | null; reason: "macro" | "header" | "forwarded" | "few" | "none" } {
  if ((diag.distinct.macro ?? 0) > 0) return { source: "macro", reason: "macro" };
  if ((diag.distinct.device ?? 0) > 0) return { source: "header", reason: "header" };
  if (diag.forwarded > 0) {
    const many = (diag.distinct.xff0 ?? 0) >= Math.max(10, diag.reach / 3);
    return many ? { source: "forwarded", reason: "forwarded" } : { source: null, reason: "few" };
  }
  return { source: null, reason: "none" };
}
