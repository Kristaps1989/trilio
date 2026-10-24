import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { isUiLocale, LANG_COOKIE, localizedPath, type UiLocale } from "./routing";

/**
 * An internal address in the request's language, for server redirects:
 * redirect(await localPath("/konts")) goes to "/en/konts" on English pages.
 * Absolute URLs (a payment page) pass through unchanged.
 */
export async function localPath(path: string): Promise<string> {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const locale = await getLocale();
  return localizedPath(path, isUiLocale(locale) ? locale : "lv");
}

/**
 * Called by the sign-in actions: remembers the page's language in the
 * language cookie, so an account created now gets it as its e-mail
 * language (users.locale, set by the createUser event in src/auth.ts) and the
 * home page opens in it next time.
 */
export async function rememberLanguage(): Promise<void> {
  const locale = await getLocale();
  (await cookies()).set(LANG_COOKIE, isUiLocale(locale) ? locale : "lv", {
    path: "/",
    maxAge: 365 * 24 * 3600,
    sameSite: "lax",
  });
}

/** The language remembered by the cookie, for code outside a localised page (Auth.js callbacks). */
export async function rememberedLanguage(): Promise<UiLocale> {
  try {
    const value = (await cookies()).get(LANG_COOKIE)?.value;
    return isUiLocale(value) ? value : "lv";
  } catch {
    return "lv";
  }
}
