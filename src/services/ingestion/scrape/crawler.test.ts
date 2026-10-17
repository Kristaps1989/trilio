import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FeedFetchError } from "../fetch";
import {
  categoryLabel,
  ScrapeBlockedError,
  ScrapeConfigSchema,
  scrapeStore,
  type ScrapeDeps,
} from "./crawler";
import { GRAPH_PAGE, INLINE_PAGE } from "./fixtures";

const HOST = "https://shop.example";
const P1 = `${HOST}/p/products/1/Ledusskapji/Gorenje/RF414EPS4`;
const P2 = `${HOST}/p/products/2/Velasmasinas/Bosch/WAN28281BY`;
const ACCESSORY = `${HOST}/p/products/3/Ledusskapju+piederumi/X/Y`;
const PRIVATE = `${HOST}/private/p/products/4/Ledusskapji/A/B`;

const config = ScrapeConfigSchema.parse({
  sitemaps: [`${HOST}/sitemap.xml`],
  include: ["^/p/products/\\d+/(Ledusskapji|Velasmasinas|Ledusskapju\\+piederumi)/"],
  exclude: ["piederumi"],
  categoryFromUrl: "^/p/products/\\d+/([^/]+)/",
});

const store = { slug: "shop", categoryMap: { ledusskapji: "fridge", velasmasinas: "washer" } };

const urlset = (urls: string[]) =>
  `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;

function http(status: number) {
  return () => {
    throw new FeedFetchError(`HTTP ${status}`, "http_error", status);
  };
}

function deps(routes: Record<string, string | Buffer | (() => never)>, extra: Partial<ScrapeDeps> = {}) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const d: ScrapeDeps = {
    get: async (url) => {
      calls.push(url);
      const r = routes[url];
      if (r === undefined) throw new FeedFetchError("not found", "http_error", 404);
      if (typeof r === "function") return r();
      return Buffer.isBuffer(r) ? r : Buffer.from(r);
    },
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  };
  return { d, calls, sleeps };
}

const BASE_ROUTES = {
  [`${HOST}/robots.txt`]: "User-agent: *\nDisallow: /private\nCrawl-delay: 3",
  [`${HOST}/sitemap.xml`]: `<sitemapindex><sitemap><loc>${HOST}/s1.xml.gz</loc></sitemap><sitemap><loc>https://other.example/s.xml</loc></sitemap></sitemapindex>`,
  [`${HOST}/s1.xml.gz`]: gzipSync(
    urlset([P1, P2, ACCESSORY, PRIVATE, "https://other.example/p/products/9/Ledusskapji/a/b", "not a url"]),
  ),
  [P1]: GRAPH_PAGE(P1),
  [P2]: INLINE_PAGE(P2),
};

describe("scrapeStore", () => {
  it("follows robots, sitemap indexes and URL patterns, and maps categories from the URL", async () => {
    const { d, calls, sleeps } = deps(BASE_ROUTES);
    const r = await scrapeStore(config, store, d);
    expect(r.urlsDiscovered).toBe(2);
    expect(r.pagesFetched).toBe(2);
    expect(r.complete).toBe(true);
    expect(r.offers.map((o) => [o.subcategoryId, o.ean, o.priceCents, o.stock])).toEqual([
      ["fridge", "3838782525551", 21999, "in"],
      ["washer", "4242005217380", 48300, "in"],
    ]);
    expect(calls).not.toContain(PRIVATE);
    expect(calls).not.toContain(ACCESSORY);
    expect(calls.some((c) => c.includes("other.example"))).toBe(false);
    // Crawl-delay 3 s beats the configured 1.5 s; one wait before every request after robots.txt.
    expect(sleeps).toEqual([3000, 3000, 3000, 3000]);
  });

  it("rejects pages whose category is not in the store's map (no free-text fallback)", async () => {
    const { d } = deps(BASE_ROUTES);
    const r = await scrapeStore(config, { slug: "shop", categoryMap: { ledusskapji: "fridge" } }, d);
    expect(r.offers).toHaveLength(1);
    expect(r.rejected.map((x) => x.reason)).toContain("unmapped_category");
  });

  it("reads never-seen pages first, then the longest-unseen, and reports a capped run as partial", async () => {
    const lastSeen = new Map([[P1, new Date("2026-10-16T00:00:00Z")]]);
    const { d, calls } = deps(BASE_ROUTES, { lastSeen });
    const r = await scrapeStore({ ...config, maxPages: 1 }, store, d);
    expect(calls.at(-1)).toBe(P2);
    expect(r.complete).toBe(false);
  });

  it("stops at once on 429 and keeps what it has", async () => {
    const { d } = deps({ ...BASE_ROUTES, [P2]: http(429) });
    const r = await scrapeStore(config, store, d);
    expect(r.stopReason).toBe("http_429");
    expect(r.complete).toBe(false);
    expect(r.offers).toHaveLength(1);
  });

  it("stops when a page turns into a bot challenge", async () => {
    const { d } = deps({ ...BASE_ROUTES, [P1]: "<title>Just a moment...</title>" });
    const r = await scrapeStore(config, store, d);
    expect(r.stopReason).toBe("cloudflare_challenge");
    expect(r.offers).toHaveLength(0);
  });

  it("skips gone pages and pages without product data", async () => {
    const { d } = deps({ ...BASE_ROUTES, [P1]: http(404), [P2]: "<html>nothing</html>" });
    const r = await scrapeStore(config, store, d);
    expect(r.rejected.map((x) => x.reason)).toEqual(["gone", "no_product_data"]);
    expect(r.complete).toBe(true);
  });

  it("gives up after five fetch errors in a row", async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `${HOST}/p/products/${i}/Ledusskapji/a/b`);
    const timeout = () => {
      throw new FeedFetchError("timed out", "timeout");
    };
    const routes: Record<string, string | Buffer | (() => never)> = {
      ...BASE_ROUTES,
      [`${HOST}/s1.xml.gz`]: urlset(urls),
    };
    for (const u of urls) routes[u] = timeout;
    const { d } = deps(routes);
    const r = await scrapeStore(config, store, d);
    expect(r.stopReason).toBe("repeated_errors");
    expect(r.rejected.filter((x) => x.reason === "fetch_error")).toHaveLength(5);
  });

  it("stops when the time budget runs out", async () => {
    let t = 0;
    const { d } = deps(BASE_ROUTES, { now: () => (t += 60 * 60_000) });
    const r = await scrapeStore({ ...config, maxRunMinutes: 90 }, store, d);
    expect(r.stopReason).toBe("time_budget");
  });

  it("treats a missing robots.txt as allow-all and records sitemap errors", async () => {
    const routes = { ...BASE_ROUTES };
    delete (routes as Record<string, unknown>)[`${HOST}/robots.txt`];
    routes[`${HOST}/sitemap.xml`] =
      `<sitemapindex><sitemap><loc>${HOST}/missing.xml</loc></sitemap><sitemap><loc>${HOST}/s1.xml.gz</loc></sitemap></sitemapindex>`;
    const { d } = deps(routes);
    const r = await scrapeStore(config, store, d);
    expect(r.rejected[0]!.reason).toBe("sitemap_error");
    expect(r.offers).toHaveLength(3 - 1); // P1, P2 (PRIVATE is allowed now but /private/ fails include)
  });

  it("throws when the shop blocks the crawler before any product page", async () => {
    const challenge = { ...BASE_ROUTES, [`${HOST}/robots.txt`]: "<title>Just a moment...</title>" };
    await expect(scrapeStore(config, store, deps(challenge).d)).rejects.toThrow(ScrapeBlockedError);
    const forbidden = { ...BASE_ROUTES, [`${HOST}/robots.txt`]: http(403) };
    await expect(scrapeStore(config, store, deps(forbidden).d)).rejects.toThrow(/HTTP 403/);
    const sitemap403 = { ...BASE_ROUTES, [`${HOST}/sitemap.xml`]: http(403) };
    await expect(scrapeStore(config, store, deps(sitemap403).d)).rejects.toThrow(/sitemap with HTTP 403/);
    const sitemapChallenge = { ...BASE_ROUTES, [`${HOST}/sitemap.xml`]: "<title>Just a moment...</title>" };
    await expect(scrapeStore(config, store, deps(sitemapChallenge).d)).rejects.toThrow(ScrapeBlockedError);
    const robots500 = { ...BASE_ROUTES, [`${HOST}/robots.txt`]: http(500) };
    await expect(scrapeStore(config, store, deps(robots500).d)).rejects.toThrow(/HTTP 500/);
  });

  it("decodes + and percent escapes before matching the category pattern", () => {
    expect(
      categoryLabel(new URL(`${HOST}/p/products/1/Velas+zavetaji/x`), "^/p/products/\\d+/([^/]+)/"),
    ).toBe("velas zavetaji");
    expect(categoryLabel(new URL(`${HOST}/p/products/1/%E0%A4%A/x`), "^/p/products/\\d+/([^/]+)/")).toBe(
      "%e0%a4%a",
    );
    expect(categoryLabel(new URL(`${HOST}/x`), undefined)).toBeUndefined();
  });
});
