"use client";

import { useLocale } from "next-intl";
import { isUiLocale, type UiLocale } from "./routing";

/** The page's UI language in client components, for the formatters (src/i18n/format.ts). */
export function useUiLocale(): UiLocale {
  const locale = useLocale();
  return isUiLocale(locale) ? locale : "lv";
}
