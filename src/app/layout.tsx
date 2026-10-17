import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Figtree } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { appBaseUrl } from "@/services/payments";
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
    openGraph: {
      siteName: "Trilio",
      type: "website",
      locale: "lv_LV",
      title: t("title"),
      description: t("description"),
    },
    twitter: { card: "summary" },
    robots: { index: true, follow: true },
    // Google Search Console: set GOOGLE_SITE_VERIFICATION in the environment.
    verification: process.env.GOOGLE_SITE_VERIFICATION
      ? { google: process.env.GOOGLE_SITE_VERIFICATION }
      : undefined,
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
      <body className="flex min-h-full flex-col">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
