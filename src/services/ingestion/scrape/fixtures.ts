// Hand-written pages that mirror the JSON-LD shapes seen on partner shops:
// a @graph document with the Offer referenced by @id and an entity-encoded
// script type (GRAPH_PAGE), and a plain Product with an inline Offer and a
// double-encoded name (INLINE_PAGE). Not copies of any shop's page.

export const GRAPH_PAGE = (url: string) => `<!doctype html><html><head>
<script type="application/ld&#x2B;json">${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage", "@id": url + "#page" },
    {
      "@type": "Product",
      brand: { "@type": "Brand", name: "Gorenje" },
      category: "Sadzīves tehnika > Ledusskapji > Ledusskapji",
      offers: { "@id": url + "#offer" },
      sku: "RF414EPS4",
      gtin13: "3838782525551",
      image: "https://shop-a.example/img/1.avif",
      name: "Gorenje, 206 L, augstums 144 cm, pel&#x113;ka - Ledusskapis",
      url,
      description: "<p>Kompakts ledusskapis</p> &bull; LED",
    },
    {
      "@type": "Offer",
      "@id": url + "#offer",
      price: 219.99,
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  ],
})}</script></head><body></body></html>`;

export const INLINE_PAGE = (url: string, over: Record<string, unknown> = {}) => `<html><head>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Bosch WAN28 ve&amp;quot;ļas mašīna",
  sku: "WAN28281BY",
  gtin13: "4242005217380",
  brand: { "@type": "Brand", name: "Bosch" },
  image: ["https://pictures.shop-b.example/1.webp", "https://pictures.shop-b.example/2.webp"],
  url,
  offers: {
    "@type": "Offer",
    price: "483.00",
    priceCurrency: "EUR",
    itemCondition: "https://schema.org/NewCondition",
    availability: "https://schema.org/InStock",
    url,
  },
  ...over,
})}</script></head></html>`;
