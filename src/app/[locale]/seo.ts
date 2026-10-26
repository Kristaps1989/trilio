import type { Metadata } from "next";
import { activeLocale } from "@/i18n/active";
import { htmlLang } from "@/i18n/request";
import { localizedPath, type UiLocale } from "@/i18n/routing";
import { appBaseUrl } from "@/services/payments";

// Shared search and sharing metadata. A page's `openGraph` replaces the
// layout's whole object (Next.js does not merge it), so pages that set their
// own title spread openGraphBase() to keep the site name, locale and share image.

const OG_ALT: Record<UiLocale, string> = {
  lv: "Trilio — trīs labākie. Bez meklēšanas.",
  en: "Trilio — the best three. No searching.",
};
const OG_LOCALE: Record<UiLocale, string> = { lv: "lv_LV", en: "en_GB" };

export const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: OG_ALT.lv };

export function openGraphBase(locale: UiLocale = activeLocale()) {
  return {
    siteName: "Trilio",
    type: "website",
    locale: OG_LOCALE[locale],
    alternateLocale: [OG_LOCALE[locale === "en" ? "lv" : "en"]],
    images: [{ ...OG_IMAGE, alt: OG_ALT[locale] }],
  } satisfies NonNullable<Metadata["openGraph"]>;
}

/**
 * The same page in each language, for hreflang (alternates.languages) and the
 * sitemap. `path` is the unprefixed path, e.g. "/kategorija/fridge".
 */
export function languageAlternates(path: string): Record<string, string> {
  const base = appBaseUrl();
  return {
    [htmlLang("lv")]: `${base}${path}`,
    en: `${base}${localizedPath(path, "en")}`,
    "x-default": `${base}${path}`,
  };
}

/**
 * Canonical URL in the page's language, hreflang links and Open Graph for an
 * indexable page at `path`. `canonicalPath` names another page when this one
 * repeats it (a budget page with the base page's picks): canonical and hreflang
 * then both point there, as Google asks.
 */
export function pageMetadata(
  path: string,
  title: string,
  description?: string,
  canonicalPath: string = path,
): Metadata {
  const locale = activeLocale();
  const url = `${appBaseUrl()}${localizedPath(canonicalPath, locale)}`;
  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical: url, languages: languageAlternates(canonicalPath) },
    openGraph: { ...openGraphBase(locale), title, url, ...(description ? { description } : {}) },
  };
}

/** Pages that must stay out of search results but whose links may be followed. */
export const NOINDEX: Metadata["robots"] = { index: false, follow: true };
