import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeXmlEntities, parseSitemap, sitemapBodyToText } from "./sitemap";

describe("sitemaps", () => {
  it("parses a sitemap index and decodes &amp; in locations", () => {
    const xml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://shop.example/sitemap.xml?type=Product&amp;cat=1394</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(xml)).toEqual({
      kind: "index",
      entries: [{ loc: "https://shop.example/sitemap.xml?type=Product&cat=1394", lastmod: undefined }],
    });
  });

  it("parses a urlset with lastmod and skips entries without loc", () => {
    const xml = `<urlset><url><loc>https://shop.example/p/1</loc><lastmod>2026-10-17</lastmod></url><url><lastmod>x</lastmod></url></urlset>`;
    expect(parseSitemap(xml)).toEqual({
      kind: "urlset",
      entries: [{ loc: "https://shop.example/p/1", lastmod: "2026-10-17" }],
    });
  });

  it("inflates gzip by magic bytes and passes plain text through", () => {
    const xml = "<urlset></urlset>";
    expect(sitemapBodyToText(gzipSync(xml))).toBe(xml);
    expect(sitemapBodyToText(Buffer.from(xml))).toBe(xml);
  });

  it("does not expand custom entities", () => {
    const xml = `<!DOCTYPE x [<!ENTITY a "boom">]><urlset><url><loc>https://s.example/&a;</loc></url></urlset>`;
    expect(parseSitemap(xml).entries[0]!.loc).toBe("https://s.example/&a;");
    expect(decodeXmlEntities("&lt;&gt;&quot;&apos;&amp;amp;")).toBe(`<>"'&amp;`);
  });
});
