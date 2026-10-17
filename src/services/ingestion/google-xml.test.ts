import { describe, expect, it } from "vitest";
import { googleXmlAdapter } from "./google-xml";

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>Veikals</title>
<item>
  <g:id>SKU-1</g:id>
  <title>Bosch KGN39VLCT ledusskapis</title>
  <link>https://shop.example.com/p/sku-1</link>
  <g:image_link>https://cdn.example.com/sku-1.jpg</g:image_link>
  <g:price>699.00 EUR</g:price>
  <g:sale_price>649.00 EUR</g:sale_price>
  <g:availability>in stock</g:availability>
  <g:gtin>4003174289161</g:gtin>
  <g:brand>Bosch</g:brand>
  <g:mpn>KGN39VLCT</g:mpn>
  <g:condition>new</g:condition>
  <g:product_type>Sadzīves tehnika &gt; Ledusskapji</g:product_type>
  <g:shipping><g:country>LV</g:country><g:service>Kurjers</g:service><g:price>9.99 EUR</g:price></g:shipping>
</item>
<item>
  <g:id>SKU-2</g:id>
  <title>Samsung RB34C672ESA (atjaunots)</title>
  <link>https://shop.example.com/p/sku-2</link>
  <g:price>489,00 EUR</g:price>
  <g:availability>preorder</g:availability>
  <g:gtin>4003017679616</g:gtin>
  <g:brand>Samsung</g:brand>
  <g:mpn>RB34C672ESA</g:mpn>
  <g:condition>refurbished</g:condition>
  <g:product_type>Ledusskapji</g:product_type>
</item>
<item>
  <g:id>SKU-3</g:id>
  <title>Televizors 55"</title>
  <link>https://shop.example.com/p/sku-3</link>
  <g:price>499 EUR</g:price>
  <g:availability>in_stock</g:availability>
  <g:gtin>4003174289161</g:gtin>
  <g:product_type>Televizori</g:product_type>
</item>
<item>
  <g:id>SKU-4</g:id>
  <title>Bez cenas</title>
  <link>https://shop.example.com/p/sku-4</link>
  <g:availability>in stock</g:availability>
  <g:mpn>X1</g:mpn>
  <g:product_type>Ledusskapji</g:product_type>
</item>
</channel>
</rss>`;

const store = {
  slug: "shop",
  categoryMap: { Ledusskapji: "fridge", "Sadzīves tehnika > Ledusskapji": "fridge" },
};

describe("googleXmlAdapter", () => {
  const result = googleXmlAdapter.parse(feed, store);

  it("parses mapped items, prefers sale price and ignores nested shipping nodes", () => {
    const bosch = result.offers.find((o) => o.externalId === "SKU-1")!;
    expect(bosch).toMatchObject({
      ean: "4003174289161",
      brand: "Bosch",
      modelCode: "KGN39VLCT",
      subcategoryId: "fridge",
      priceCents: 64900,
      stock: "in",
      condition: "new",
      imageUrl: "https://cdn.example.com/sku-1.jpg",
      url: "https://shop.example.com/p/sku-1",
    });
  });

  it("handles comma decimals, preorder and refurbished", () => {
    const samsung = result.offers.find((o) => o.externalId === "SKU-2")!;
    expect(samsung).toMatchObject({ priceCents: 48900, stock: "soon", condition: "refurbished" });
  });

  it("skips categories we don't handle and rows without a price", () => {
    expect(result.offers.map((o) => o.externalId)).toEqual(["SKU-1", "SKU-2"]);
    expect(result.rejected.map((r) => r.reason)).toEqual(["unmapped_category", "price"]);
  });

  it("refuses documents with a DOCTYPE or entity declarations", () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><item><g:id>1</g:id></item></channel></rss>`;
    const r = googleXmlAdapter.parse(evil, store);
    expect(r.offers).toEqual([]);
    expect(r.rejected[0]!.reason).toBe("doctype_not_allowed");
  });

  it("does not throw on malformed XML", () => {
    const r = googleXmlAdapter.parse("<rss><channel><item>", store);
    expect(r.offers).toEqual([]);
  });

  it("accepts the Atom variant", () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:g="http://base.google.com/ns/1.0"><entry><g:id>A1</g:id><title>Beko saldētava</title><link>https://shop.example.com/a1</link><g:price>249 EUR</g:price><g:availability>in stock</g:availability><g:mpn>BE5506SD</g:mpn><g:brand>Beko</g:brand><g:product_type>Saldētavas</g:product_type></entry></feed>`;
    const r = googleXmlAdapter.parse(atom, { slug: "shop", categoryMap: { Saldētavas: "freezer" } });
    expect(r.offers).toHaveLength(1);
    expect(r.offers[0]).toMatchObject({ subcategoryId: "freezer", ean: null, modelCode: "BE5506SD" });
  });
});
