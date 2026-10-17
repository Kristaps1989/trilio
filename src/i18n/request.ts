import { getRequestConfig } from "next-intl/server";

// Single locale for launch. LT and EE are added here (and in messages/) later;
// the UI never hard-codes a language.
export const locales = ["lv"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "lv";

export default getRequestConfig(async () => {
  const locale = defaultLocale;
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
    timeZone: "Europe/Riga",
  };
});
