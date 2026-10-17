import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { offers, products, stores, type Store } from "@/db/schema";
import { gtinCheckDigit } from "@/domain/catalog/ean";
import { FeedFetchError } from "./fetch";
import { ingestStore, scraperUserAgent } from "./run";

// Integration test for the scrape branch of ingestStore against DATABASE_URL.
// The network is replaced by scrapeDeps; rows live under a "test-scrape" store.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

const HOST = "https://shop.test-scrape.invalid";
// Unique to this file: other DB tests own 990000000001 and 990000000777.
const EAN = "990000000555";
const GTIN = EAN + gtinCheckDigit(EAN);
const PAGE = `${HOST}/p/1/Tejkannas/x`;

const page = (price: string) =>
  `<script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    name: "ScrapeBrand TK-1 tējkanna",
    sku: "test-scrape:TK-1",
    gtin13: GTIN,
    brand: "ScrapeBrand",
    offers: { price, priceCurrency: "EUR", availability: "https://schema.org/InStock" },
  })}</script>`;

run("ingestStore with a scraped store", () => {
  let db: Db;
  let end: () => Promise<void>;
  let store: Store;

  beforeAll(async () => {
    const created = createDb();
    db = created.db;
    end = () => created.client.end();
    await db.delete(stores).where(eq(stores.slug, "test-scrape"));
    [store] = await db
      .insert(stores)
      .values({
        slug: "test-scrape",
        displayName: "Test scrape",
        feedType: "scrape",
        categoryMap: { tejkannas: "kettle" },
        scrapeConfig: {
          sitemaps: [`${HOST}/sitemap.xml`],
          include: ["^/p/\\d+/"],
          categoryFromUrl: "^/p/\\d+/([^/]+)/",
        },
        active: false,
      })
      .returning();
  });

  afterAll(async () => {
    const own = await db.select({ id: offers.productId }).from(offers).where(eq(offers.storeId, store.id));
    await db.delete(stores).where(eq(stores.id, store.id));
    for (const o of own) await db.delete(products).where(eq(products.id, o.id));
    await end();
  });

  const deps = (price: string, status?: number) => ({
    sleep: async () => {},
    get: async (u: string) => {
      if (u.endsWith("/robots.txt")) throw new FeedFetchError("missing", "http_error", 404);
      if (u.endsWith("/sitemap.xml")) return Buffer.from(`<urlset><url><loc>${PAGE}</loc></url></urlset>`);
      if (status) throw new FeedFetchError("slow down", "http_error", status);
      return Buffer.from(page(price));
    },
  });

  it("stores scraped offers and reports pages read", async () => {
    const r = await ingestStore(db, store, { scrapeDeps: deps("19.99") });
    expect(r).toMatchObject({ ok: true, rowsUpserted: 1, pagesFetched: 1, productsCreated: 1 });
    const [o] = await db.select().from(offers).where(eq(offers.storeId, store.id));
    expect(o).toMatchObject({ priceCents: 1999, stock: "in", url: PAGE });
  });

  it("keeps offers when the shop asks us to stop, and says why", async () => {
    const later = new Date(Date.now() + 30 * 3_600_000);
    const r = await ingestStore(db, store, { scrapeDeps: deps("19.99", 429), now: later });
    expect(r).toMatchObject({ ok: true, stopReason: "http_429", markedOut: 0 });
  });

  it("fails the run cleanly on an invalid config", async () => {
    const r = await ingestStore(db, { ...store, scrapeConfig: { sitemaps: [] } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sitemaps/);
  });

  it("identifies itself with the product token and site URL", () => {
    expect(scraperUserAgent()).toMatch(/TrilioBot\/1\.0; \+https?:\/\//);
  });
});
