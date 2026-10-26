import { NextResponse, type NextRequest } from "next/server";
import { trackingHosts } from "@/config/analytics";
import { LANG_COOKIE } from "@/i18n/routing";

// Two jobs on every request:
//
// 1. Language (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md §4.1). The market's own
//    language has no prefix: "/izvelies" is served by the [locale] = "lv"
//    routes through a rewrite. English is "/en/izvelies". "/lv/…" redirects
//    to the unprefixed address. The URL alone decides the language; the
//    switch in the header adds ?lang=, which is remembered in a cookie so the
//    next visit to the home page opens in that language.
// 2. Nonce-based Content Security Policy. Next.js reads the nonce from the
//    `x-nonce` request header and applies it to the scripts it injects, so no
//    `unsafe-inline` is needed for scripts in production. In development the
//    React refresh runtime needs `unsafe-eval`.

/** Addresses outside the localised pages: APIs, the affiliate redirect, the TV tracker and short link, files. */
const UNLOCALISED =
  /^\/(api|_next|go|px|tv)(\/|$)|^\/(robots\.txt|sitemap\.xml|llms\.txt|favicon\.ico|icon\.svg)$|\.[a-z0-9]{2,5}$/i;

/** Next.js and next-intl read the request's language from this header. */
const LOCALE_HEADER = "X-NEXT-INTL-LOCALE";
const YEAR_S = 365 * 24 * 3600;

function csp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  // Google Analytics and Google Ads hosts only when configured; both still load only after consent.
  const hosts = trackingHosts();
  const ga = hosts.length ? ` ${hosts.join(" ")}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${ga}${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind and next/font emit <style> tags; styles are not an injection vector we accept scripts from.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${ga}`,
    "font-src 'self'",
    `connect-src 'self'${ga}`,
    ...(ga ? ["frame-src 'self' https://www.googletagmanager.com"] : []),
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = csp(nonce);
  const { pathname, searchParams } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const withCsp = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", policy);
    return response;
  };

  if (UNLOCALISED.test(pathname)) return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));

  // The switch: remember the choice and drop the parameter from the address.
  const lang = searchParams.get("lang");
  if (lang === "lv" || lang === "en") {
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("lang");
    const response = NextResponse.redirect(clean);
    response.cookies.set(LANG_COOKIE, lang, { path: "/", maxAge: YEAR_S, sameSite: "lax" });
    return withCsp(response);
  }

  // "/lv/izvelies" is never a public address: send it to "/izvelies".
  if (pathname === "/lv" || pathname.startsWith("/lv/")) {
    const target = request.nextUrl.clone();
    target.pathname = pathname.slice(3) || "/";
    return withCsp(NextResponse.redirect(target, 308));
  }

  if (pathname === "/en" || pathname.startsWith("/en/")) {
    requestHeaders.set(LOCALE_HEADER, "en");
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // The home page opens in the language last chosen with the switch.
  if (pathname === "/" && request.cookies.get(LANG_COOKIE)?.value === "en") {
    const target = request.nextUrl.clone();
    target.pathname = "/en";
    return withCsp(NextResponse.redirect(target));
  }

  requestHeaders.set(LOCALE_HEADER, "lv");
  const target = request.nextUrl.clone();
  target.pathname = `/lv${pathname === "/" ? "" : pathname}`;
  return withCsp(NextResponse.rewrite(target, { request: { headers: requestHeaders } }));
}

export const config = {
  // Everything but static assets: prefetches too, because they need the language rewrite.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
