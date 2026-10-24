import { defineRouting } from "next-intl/routing";

// Languages served by one deployment (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md
// §3–§4.1). The market's own language has no prefix (trilio.lv/izvelies);
// English lives under /en (trilio.lv/en/izvelies), with the same Latvian path
// words. "lv" is the segment name of the market's own language: an LT or EE
// deployment serves its own texts under it (src/i18n/request.ts). The
// language is chosen by the URL only; src/proxy.ts maps unprefixed paths to
// the "lv" segment and remembers an explicit switch in a cookie.

export const routing = defineRouting({
  locales: ["lv", "en"],
  defaultLocale: "lv",
  localePrefix: "as-needed",
  localeDetection: false,
});

export type UiLocale = (typeof routing.locales)[number];

export function isUiLocale(value: unknown): value is UiLocale {
  return value === "lv" || value === "en";
}

/** The cookie that remembers an explicit language switch for the next visit to the home page. */
export const LANG_COOKIE = "trilio_lang";

function split(path: string): [string, string] {
  const i = path.search(/[?#]/);
  return i < 0 ? [path, ""] : [path.slice(0, i), path.slice(i)];
}

/** "/en/izvelies?x=1" → "/izvelies?x=1"; other paths unchanged. */
export function stripLocale(path: string): string {
  const [pathname, rest] = split(path);
  if (pathname === "/en") return `/${rest}`;
  return pathname.startsWith("/en/") ? pathname.slice(3) + rest : path;
}

/** The same page in a language: "/izvelies" + en → "/en/izvelies"; "/?a=1" + en → "/en?a=1". */
export function localizedPath(path: string, locale: UiLocale): string {
  const bare = stripLocale(path);
  if (locale === "lv") return bare;
  const [pathname, rest] = split(bare);
  return `${pathname === "/" ? "/en" : `/en${pathname}`}${rest}`;
}

/** The language a browser path is in. */
export function localeOfPath(path: string): UiLocale {
  return path === "/en" || path.startsWith("/en/") || path.startsWith("/en?") ? "en" : "lv";
}
