import { describe, expect, it } from "vitest";
import { GRAPH_PAGE, INLINE_PAGE } from "./fixtures";
import { reviewScore } from "../common";
import { decodeEntities, eanFromAttributes, extractProducts, jsonLdNodes } from "./jsonld";

const URL_A = "https://shop-a.example/sadzives-tehnika/ledusskapji/ledusskapji/rf414eps4/gorenje";
const URL_B = "https://www.shop-b.example/p/products/1/Velasmasinas/Bosch/WAN28281BY";

describe("JSON-LD product extraction", () => {
  it("resolves @graph and an Offer referenced by @id", () => {
    expect(extractProducts(GRAPH_PAGE(URL_A), URL_A)).toEqual([
      {
        id: "RF414EPS4",
        title: "Gorenje, 206 L, augstums 144 cm, pelēka - Ledusskapis",
        description: "Kompakts ledusskapis • LED",
        link: URL_A,
        image_link: "https://shop-a.example/img/1.avif",
        price: "219.99",
        availability: "in_stock",
        gtin: "3838782525551",
        brand: "Gorenje",
        mpn: "RF414EPS4",
        condition: "new",
        google_product_category: "Sadzīves tehnika > Ledusskapji > Ledusskapji",
      },
    ]);
  });

  it("reads an inline Offer, the first image and double-encoded names", () => {
    const [r] = extractProducts(INLINE_PAGE(URL_B), URL_B);
    expect(r).toMatchObject({
      title: 'Bosch WAN28 "Serie 4" veļas mašīna',
      image_link: "https://pictures.shop-b.example/1.webp",
      price: "483.00",
      gtin: "4242005217380",
    });
  });

  it("maps availability and condition, and rejects used items via condition", () => {
    const out = (o: Record<string, unknown>) =>
      extractProducts(INLINE_PAGE(URL_B, { offers: { price: "10", priceCurrency: "EUR", ...o } }), URL_B)[0]!;
    expect(out({ availability: "https://schema.org/OutOfStock" }).availability).toBe("out_of_stock");
    expect(out({ availability: "PreOrder" }).availability).toBe("preorder");
    expect(out({ availability: "Weird" }).availability).toBeUndefined();
    expect(out({ itemCondition: "https://schema.org/RefurbishedCondition" }).condition).toBe("refurbished");
    expect(out({ itemCondition: "https://schema.org/UsedCondition" }).condition).toBe("unsupported");
  });

  it("picks the cheapest in-stock EUR offer and handles AggregateOffer", () => {
    const offers = [
      { price: "300", priceCurrency: "EUR", availability: "InStock" },
      { price: "100", priceCurrency: "USD", availability: "InStock" },
      { price: "200", priceCurrency: "EUR", availability: "OutOfStock" },
      { price: "250", priceCurrency: "EUR", availability: "InStock" },
    ];
    expect(extractProducts(INLINE_PAGE(URL_B, { offers }), URL_B)[0]!.price).toBe("250");
    const agg = { "@type": "AggregateOffer", lowPrice: 199, priceCurrency: "EUR" };
    expect(extractProducts(INLINE_PAGE(URL_B, { offers: agg }), URL_B)[0]!.price).toBe("199");
  });

  it("keeps links on the page's host and https images only", () => {
    const r = extractProducts(
      INLINE_PAGE(URL_B, {
        url: "https://evil.example/x",
        offers: { price: "1", url: "https://evil.example/y" },
        image: "http://pictures.shop-b.example/1.jpg",
      }),
      URL_B,
    )[0]!;
    expect(r.link).toBe(URL_B);
    expect(r.image_link).toBeUndefined();
  });

  it("uses a plain-string brand and falls back to the URL when there is no sku or gtin", () => {
    const r = extractProducts(
      INLINE_PAGE(URL_B, { brand: "LG", sku: undefined, gtin13: undefined }),
      URL_B,
    )[0]!;
    expect(r.brand).toBe("LG");
    expect(r.id).toBe(URL_B);
  });

  it("ignores broken blocks and pages without Product data", () => {
    const html = `<script type="application/ld+json">{broken</script><script type='application/ld+json'>{"@type":"Organization"}</script>`;
    expect(jsonLdNodes(html)).toHaveLength(1);
    expect(extractProducts(html, URL_B)).toEqual([]);
  });

  it("decodes numeric and named entities, leaving unknown ones", () => {
    expect(decodeEntities("&#x113;&#257;&nbsp;&amp;amp;&unknown;&#0;")).toBe("ēā &&unknown;&#0;");
  });

  it("takes the EAN from data attributes when JSON-LD has none", () => {
    const noGtin = INLINE_PAGE(URL_B, { gtin13: undefined });
    const html = `${noGtin}<div data-ean="4242005217380" data-product-ean="4242005217380"></div>`;
    expect(extractProducts(html, URL_B)[0]!.gtin).toBe("4242005217380");
    expect(extractProducts(`${noGtin}<b data-flix-ean='8806084641519'>`, URL_B)[0]!.gtin).toBe(
      "8806084641519",
    );
  });

  it("ignores data attributes that disagree, and never overrides JSON-LD", () => {
    expect(
      eanFromAttributes('<a data-ean="4242005217380"></a><a data-ean="8806084641519"></a>'),
    ).toBeUndefined();
    expect(eanFromAttributes("<p>no attributes</p>")).toBeUndefined();
    const withGtin = `${INLINE_PAGE(URL_B)}<div data-ean="8806084641519"></div>`;
    expect(extractProducts(withGtin, URL_B)[0]!.gtin).toBe("4242005217380");
  });

  it("does not attach an attribute EAN when the page lists several products", () => {
    const two = `${INLINE_PAGE(URL_B, { gtin13: undefined })}${INLINE_PAGE(URL_B, { gtin13: undefined, sku: "B" })}`;
    const records = extractProducts(`${two}<div data-ean="4242005217380"></div>`, URL_B);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.gtin === undefined)).toBe(true);
  });
});

describe("shop reviews (docs/CONFIDENCE_PLAN.md B1)", () => {
  const page = (rating: unknown) =>
    `<script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Bosch KGN39",
      sku: "k1",
      brand: "Bosch",
      aggregateRating: rating,
      offers: {
        "@type": "Offer",
        price: "599",
        priceCurrency: "EUR",
        availability: "https://schema.org/InStock",
      },
    })}</script>`;

  it("reads the score, the scale and the count", () => {
    const [r] = extractProducts(
      page({ "@type": "AggregateRating", ratingValue: "4.6", bestRating: 5, reviewCount: 128 }),
      "https://shop.example/p",
    );
    expect(r).toMatchObject({ rating_value: "4.6", rating_best: "5", rating_count: "128" });
    expect(reviewScore(r!)).toEqual({ ratingX10: 46, ratingCount: 128 });
  });

  it("drops a score without a count, out of range, or on another scale", () => {
    expect(reviewScore({ rating_value: "4.6" })).toEqual({ ratingX10: null, ratingCount: null });
    expect(reviewScore({ rating_value: "6", rating_count: "3" })).toEqual({
      ratingX10: null,
      ratingCount: null,
    });
    expect(reviewScore({ rating_value: "9", rating_best: "10", rating_count: "20" })).toEqual({
      ratingX10: 45,
      ratingCount: 20,
    });
    const [none] = extractProducts(page(undefined), "https://shop.example/p");
    expect(none!.rating_value).toBeUndefined();
  });
});
