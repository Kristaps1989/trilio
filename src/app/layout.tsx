import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Figtree } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { analyticsId } from "@/config/analytics";
import { appBaseUrl } from "@/services/payments";
import { Analytics } from "@/ui/analytics/Analytics";
import { Footer } from "@/ui/shell/Footer";
import { Header } from "@/ui/shell/Header";
import { OG_IMAGE, OPEN_GRAPH } from "./seo";
import "./globals.css";

// Latin Extended covers Latvian, Lithuanian and Estonian diacritics.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700"],
  display: "swap",
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600", "700"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  const base = appBaseUrl();
  return {
    metadataBase: new URL(base),
    title: { default: t("title"), template: `%s · Trilio` },
    description: t("description"),
    applicationName: "Trilio",
    icons: { icon: "/icon.svg" },
    // No canonical here: it would be inherited by every page. Pages set their own (src/app/seo.ts).
    openGraph: { ...OPEN_GRAPH, title: t("title"), description: t("description") },
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations("meta");
  const base = appBaseUrl();
  const measurementId = analyticsId();
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
      inLanguage: locale,
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: `${base}/modelis?q={search_term_string}` },
        "query-input": "required name=search_term_string",
      },
    },
  ];
  return (
    <html lang={locale} className={`${spaceGrotesk.variable} ${figtree.variable} h-full antialiased`}>
      <body className="relative flex min-h-full flex-col">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <NextIntlClientProvider>
          {/* One shell for every page (docs/DESIGN_FIX_PLAN.md PR 1): the progress
              track, header and footer render once and persist across navigation.
              The track and header stay pinned to the top while the page scrolls. */}
          <div aria-hidden="true" className="sticky top-0 z-50 h-1 shrink-0 bg-night">
            <div className="h-full bg-track" />
          </div>
          <Header />
          <main id="saturs" className="flex flex-1 flex-col px-gutter">
            {children}
          </main>
          <Footer />
          {measurementId ? (
            <Suspense fallback={null}>
              <Analytics measurementId={measurementId} />
            </Suspense>
          ) : null}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
