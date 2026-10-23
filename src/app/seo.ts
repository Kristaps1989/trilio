import type { Metadata } from "next";
import { appBaseUrl } from "@/services/payments";

// Shared search and sharing metadata. A page's `openGraph` replaces the
// layout's whole object (Next.js does not merge it), so pages that set their
// own title spread OPEN_GRAPH to keep the site name, locale and share image.

export const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "Trilio — trīs labākie. Bez meklēšanas.",
};

export const OPEN_GRAPH = {
  siteName: "Trilio",
  type: "website",
  locale: "lv_LV",
  images: [OG_IMAGE],
} satisfies NonNullable<Metadata["openGraph"]>;

/** Canonical URL, Open Graph and description for an indexable page at `path`. */
export function pageMetadata(path: string, title: string, description?: string): Metadata {
  const url = `${appBaseUrl()}${path}`;
  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical: url },
    openGraph: { ...OPEN_GRAPH, title, url, ...(description ? { description } : {}) },
  };
}

/** Pages that must stay out of search results but whose links may be followed. */
export const NOINDEX: Metadata["robots"] = { index: false, follow: true };
