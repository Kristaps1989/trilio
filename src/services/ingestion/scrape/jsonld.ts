import type { FeedRecord } from "../common";

// Reads schema.org Product data from a product page's JSON-LD (the same data
// shops publish for Google rich results). Handles @graph documents, offers
// referenced by @id, Offer arrays, AggregateOffer, and HTML-entity-encoded
// strings. Output is a FeedRecord so the feed adapters' validation applies.

const SCRIPT_RE =
  /<script\b[^>]*\btype\s*=\s*["']?application\/ld(?:\+|&#x2B;|&#43;|&plus;)json["']?[^>]*>([\s\S]*?)<\/script>/gi;

type Node = Record<string, unknown>;

const NAMED: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: "\u00a0",
  bull: "\u2022",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  euro: "\u20ac",
  laquo: "\u00ab",
  raquo: "\u00bb",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  deg: "\u00b0",
  times: "\u00d7",
};

/** Decodes HTML entities; twice at most, because some shops double-encode. */
export function decodeEntities(input: string): string {
  let s = input;
  for (let pass = 0; pass < 2 && s.includes("&"); pass++) {
    s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      return NAMED[code.toLowerCase()] ?? whole;
    });
  }
  return s;
}

function clean(v: unknown): string | undefined {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return undefined;
  const s = decodeEntities(v)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s || undefined;
}

function types(node: Node): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
}

/** All objects in a JSON-LD document, flattened through arrays and @graph. */
function collect(value: unknown, out: Node[]): void {
  if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (value && typeof value === "object") {
    const node = value as Node;
    out.push(node);
    if (node["@graph"]) collect(node["@graph"], out);
  }
}

export function jsonLdNodes(html: string): Node[] {
  const nodes: Node[] = [];
  for (const m of html.matchAll(SCRIPT_RE)) {
    try {
      collect(JSON.parse(m[1]!.trim()), nodes);
    } catch {
      // A broken block on a shop page is not our problem; other blocks may still parse.
    }
  }
  return nodes;
}

function resolve(value: unknown, byId: Map<string, Node>): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const node = value as Node;
    const id = node["@id"];
    if (typeof id === "string" && Object.keys(node).length === 1) return byId.get(id) ?? node;
  }
  return value;
}

function pickOffer(offers: unknown, byId: Map<string, Node>): Node | undefined {
  const list = (Array.isArray(offers) ? offers : [offers])
    .map((o) => resolve(o, byId))
    .filter((o): o is Node => !!o && typeof o === "object");
  const eur = list.filter((o) => {
    const c = o.priceCurrency;
    return c === undefined || (typeof c === "string" && c.toUpperCase() === "EUR");
  });
  // The page's own offer; if a page lists several (variants), the cheapest in-stock one.
  const priced = eur
    .map((o) => ({ o, price: Number(String(o.price ?? o.lowPrice ?? "").replace(",", ".")) }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0);
  const inStock = priced.filter((x) =>
    /InStock|LimitedAvailability|OnlineOnly|InStoreOnly/.test(String(x.o.availability ?? "")),
  );
  const pool = inStock.length ? inStock : priced;
  pool.sort((a, b) => a.price - b.price);
  return pool[0]?.o;
}

function availability(v: unknown): string | undefined {
  const s = String(v ?? "").replace(/^https?:\/\/schema\.org\//i, "");
  if (/^(InStock|LimitedAvailability|OnlineOnly|InStoreOnly)$/i.test(s)) return "in_stock";
  if (/^(PreOrder|BackOrder|PreSale)$/i.test(s)) return "preorder";
  if (/^(OutOfStock|SoldOut|Discontinued)$/i.test(s)) return "out_of_stock";
  return undefined;
}

function condition(v: unknown): string {
  const s = String(v ?? "NewCondition").replace(/^https?:\/\/schema\.org\//i, "");
  if (/^NewCondition$/i.test(s)) return "new";
  if (/^RefurbishedCondition$/i.test(s)) return "refurbished";
  // Used or damaged items are neither new nor refurbished with a grade and warranty: rejected.
  return "unsupported";
}

function imageUrl(v: unknown, base: string): string | undefined {
  const first = Array.isArray(v) ? v[0] : v;
  const raw = typeof first === "string" ? first : (first as Node | undefined)?.url;
  if (typeof raw !== "string") return undefined;
  try {
    const u = new URL(decodeEntities(raw), base);
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Same-host absolute URL, else the page URL. */
function sameHostUrl(v: unknown, pageUrl: string): string {
  if (typeof v !== "string") return pageUrl;
  try {
    const u = new URL(decodeEntities(v), pageUrl);
    return u.hostname === new URL(pageUrl).hostname && u.protocol === "https:" ? u.toString() : pageUrl;
  } catch {
    return pageUrl;
  }
}

// Some shops keep the EAN out of their JSON-LD but print it in a data
// attribute for product widgets (tet.lv: data-ean / data-product-ean,
// ksenukai.lv: data-flix-ean).
const EAN_ATTR_RE = /\bdata-(?:product-|flix-)?ean\s*=\s*["'](\d{8,14})["']/gi;

/** The page's EAN from data attributes, only when every such attribute agrees. */
export function eanFromAttributes(html: string): string | undefined {
  const values = new Set([...html.matchAll(EAN_ATTR_RE)].map((m) => m[1]!));
  return values.size === 1 ? [...values][0] : undefined;
}

export function extractProducts(html: string, pageUrl: string): FeedRecord[] {
  const nodes = jsonLdNodes(html);
  const byId = new Map<string, Node>();
  for (const n of nodes) if (typeof n["@id"] === "string") byId.set(n["@id"], n);
  const records: FeedRecord[] = [];
  for (const product of nodes.filter((n) => types(n).includes("Product"))) {
    const offer = pickOffer(product.offers, byId);
    const brand = resolve(product.brand, byId);
    const gtin = [product.gtin13, product.gtin, product.gtin14, product.gtin12, product.gtin8]
      .map(clean)
      .find(Boolean);
    const sku = clean(product.sku);
    const link = sameHostUrl(offer?.url ?? product.url, pageUrl);
    records.push({
      id: sku ?? gtin ?? link,
      title: clean(product.name),
      description: clean(product.description),
      link,
      image_link: imageUrl(product.image, pageUrl),
      price: offer ? clean(offer.price ?? offer.lowPrice) : undefined,
      availability: availability(offer?.availability),
      gtin,
      brand: typeof brand === "string" ? clean(brand) : clean((brand as Node | undefined)?.name),
      mpn: clean(product.mpn) ?? sku,
      condition: condition(offer?.itemCondition ?? product.itemCondition),
      google_product_category: clean(product.category),
    });
  }
  // Only a single-product page: on a page with several products we cannot tell whose EAN it is.
  if (records.length === 1 && !records[0]!.gtin) records[0]!.gtin = eanFromAttributes(html);
  return records;
}
