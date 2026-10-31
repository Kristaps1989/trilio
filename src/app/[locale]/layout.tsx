import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { initLocale } from "@/i18n/init";
import { htmlLang } from "@/i18n/request";
import { isUiLocale, routing } from "@/i18n/routing";
import { adsTag, analyticsId, metaPixelId } from "@/config/analytics";
import { appBaseUrl } from "@/services/payments";
import { Analytics } from "@/ui/analytics/Analytics";
import { VisitBeacon } from "@/ui/analytics/VisitBeacon";
import { Footer } from "@/ui/shell/Footer";
import { Header } from "@/ui/shell/Header";
import { OG_IMAGE, openGraphBase } from "./seo";
import "../globals.css";

// Self-hosted from src/app/fonts (OFL): Latin and Latin Extended, which
// cover Latvian, Lithuanian and Estonian. Bundled rather than fetched from
// Google at build time, so a build never depends on Google Fonts answering.
const spaceGrotesk = localFont({
  variable: "--font-space-grotesk",
  src: [
    { path: "../fonts/space-grotesk-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/space-grotesk-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
});

const figtree = localFont({
  variable: "--font-figtree",
  src: [
    { path: "../fonts/figtree-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/figtree-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/figtree-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
});

type LayoutProps = { children: React.ReactNode; params: Promise<{ locale: string }> };

/** Both languages are rendered on demand; the landing pages are cached per language (ISR). */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Omit<LayoutProps, "children">): Promise<Metadata> {
  const locale = await initLocale(params);
  const t = await getTranslations({ locale, namespace: "meta" });
  const base = appBaseUrl();
  return {
    metadataBase: new URL(base),
    title: { default: t("title"), template: `%s · Trilio` },
    description: t("description"),
    applicationName: "Trilio",
    icons: { icon: "/icon.svg" },
    // No canonical here: it would be inherited by every page. Pages set their own (src/app/[locale]/seo.ts).
    openGraph: { ...openGraphBase(locale), title: t("title"), description: t("description") },
    twitter: { card: "summary_large_image", images: [OG_IMAGE.url] },
    robots: { index: true, follow: true },
    // Google Search Console: set GOOGLE_SITE_VERIFICATION in the environment.
    verification: {
      ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
      // Paysera merchant site check (a public token, not a secret); PAYSERA_SITE_VERIFICATION overrides it.
      other: {
        "paysera-verify":
          process.env.PAYSERA_SITE_VERIFICATION || "paysera-verify-18dc77756ea8bc89aa990d22e4d3af14",
      },
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0F2A2E",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children, params }: LayoutProps) {
  const { locale: raw } = await params;
  if (!isUiLocale(raw)) notFound();
  const locale = await initLocale(params);
  const t = await getTranslations({ locale, namespace: "meta" });
  const tHeader = await getTranslations({ locale, namespace: "header" });
  const base = appBaseUrl();
  const measurementId = analyticsId();
  const ads = adsTag();
  const metaPixel = metaPixelId();
  // Site-level structured data for search engines and AI assistants.
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Trilio",
      url: base,
      logo: `${base}/icon.svg`,
      slogan: t("tagline"),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Trilio",
      url: base,
      inLanguage: htmlLang(locale),
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${base}/modelis?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
  ];
  return (
    <html
      lang={htmlLang(locale)}
      className={`${spaceGrotesk.variable} ${figtree.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        {/* Skip link (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md §7, item 1): first in the
            tab order, hidden until focused, jumps past the header to the page. */}
        <a
          href="#saturs"
          className="sr-only z-[60] rounded-xl bg-lime font-bold text-night focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:inline-flex focus:min-h-11 focus:items-center focus:px-4"
        >
          {tHeader("skip")}
        </a>
        <NextIntlClientProvider>
          {/* One shell for every page (docs/DESIGN_FIX_PLAN.md PR 1): the progress
              track, header and footer render once and persist across navigation.
              The track and header stay pinned to the top while the page scrolls. */}
          <div aria-hidden="true" className="sticky top-0 z-50 h-1 shrink-0 bg-night">
            <div className="h-full bg-track" />
          </div>
          <Header />
          <main id="saturs" tabIndex={-1} className="flex flex-1 flex-col px-gutter outline-none">
            {children}
          </main>
          <Footer locale={locale} />
          <Suspense fallback={null}>
            <VisitBeacon />
          </Suspense>
          {measurementId || ads || metaPixel ? (
            <Suspense fallback={null}>
              <Analytics measurementId={measurementId} ads={ads} metaPixel={metaPixel} />
            </Suspense>
          ) : null}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
