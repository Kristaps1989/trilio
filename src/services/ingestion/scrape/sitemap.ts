import { gunzipSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";

// sitemaps.org XML: either a <sitemapindex> of child sitemaps or a <urlset>
// of pages. Gzipped bodies are inflated with an output cap (gzip bombs).

export type SitemapEntry = { loc: string; lastmod?: string };
export type Sitemap = { kind: "index" | "urlset"; entries: SitemapEntry[] };

const MAX_INFLATED_BYTES = 100 * 1024 * 1024;

const parser = new XMLParser({
  ignoreAttributes: true,
  // Security: never resolve entities (XXE / billion laughs); the five XML
  // entities that can appear in a <loc> are decoded by hand below.
  processEntities: false,
  htmlEntities: false,
  removeNSPrefix: true,
  isArray: (name) => name === "url" || name === "sitemap",
  trimValues: true,
  parseTagValue: false,
});

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Inflates gzip (by magic bytes, not file name) and decodes UTF-8. */
export function sitemapBodyToText(body: Buffer): string {
  const gz = body.length > 2 && body[0] === 0x1f && body[1] === 0x8b;
  const raw = gz ? gunzipSync(body, { maxOutputLength: MAX_INFLATED_BYTES }) : body;
  return new TextDecoder("utf-8").decode(raw);
}

export function parseSitemap(xml: string): Sitemap {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const index = doc.sitemapindex as { sitemap?: Record<string, unknown>[] } | undefined;
  const urlset = doc.urlset as { url?: Record<string, unknown>[] } | undefined;
  const nodes = index ? (index.sitemap ?? []) : (urlset?.url ?? []);
  const entries: SitemapEntry[] = [];
  for (const node of nodes) {
    if (typeof node.loc !== "string" || !node.loc) continue;
    entries.push({
      loc: decodeXmlEntities(node.loc),
      lastmod: typeof node.lastmod === "string" ? node.lastmod : undefined,
    });
  }
  return { kind: index ? "index" : "urlset", entries };
}
