import { setRequestLocale } from "next-intl/server";
import { setActiveLocale } from "./active";
import type { UiLocale } from "./routing";

/**
 * First line of every page, layout and generateMetadata under [locale]:
 * remembers the URL's language for the formatters and lets next-intl render
 * statically (landing pages are ISR).
 */
export async function initLocale(params: Promise<{ locale: string }>): Promise<UiLocale> {
  const { locale: raw } = await params;
  const locale = setActiveLocale(raw);
  setRequestLocale(locale);
  return locale;
}
