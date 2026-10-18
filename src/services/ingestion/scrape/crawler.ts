import { z } from "zod";
import { recordToOffer } from "../common";
import { FeedFetchError } from "../fetch";
import type { AdapterStore, ParseResult } from "../types";
import { detectBlock } from "./challenge";
import { extractProducts } from "./jsonld";
import { ALLOW_ALL, crawlDelaySeconds, isAllowed, parseRobots, type RobotsRules } from "./robots";
import { parseSitemap, sitemapBodyToText } from "./sitemap";

// Polite crawler for shops without a product feed: robots.txt → sitemaps →
// product pages → schema.org Product data. One request at a time, a fixed
// delay between requests (never less than the shop's Crawl-delay), an
// honest User-Agent, and a hard stop on 403/429/503 or a bot challenge.
// Which pages to read is per-store configuration (stores.scrape_config).

export const ROBOTS_TOKEN = "TrilioBot";

export const ScrapeConfigSchema = z.object({
  /** Sitemap or sitemap-index URLs on the shop's own host. */
  sitemaps: z.array(z.string().url()).min(1),
  /** Regex sources (case-insensitive); a product URL's path must match one of them. */
  include: z.array(z.string().min(1)).min(1),
  exclude: z.array(z.string().min(1)).default([]),
  /** Regex with one capture group, run on the decoded URL path; the capture is the category label for category_map. */
  categoryFromUrl: z.string().optional(),
  maxPages: z.number().int().min(1).max(20_000).default(2_000),
  /** Milliseconds between requests. At least one second. */
  delayMs: z.number().int().min(1_000).max(60_000).default(1_500),
  maxSitemaps: z.number().int().min(1).max(1_000).default(300),
  maxRunMinutes: z.number().int().min(1).max(240).default(90),
  /**
   * When a run cannot read every page (large catalogue, rotation), an offer
   * counts as out of stock only after this many hours unseen. Set it above
   * the time a full rotation takes.
   */
  staleAfterHours: z
    .number()
    .int()
    .min(24)
    .max(24 * 30)
    .default(168),
});

export type ScrapeConfig = z.infer<typeof ScrapeConfigSchema>;

export type ScrapeDeps = {
  /** Fetch with the safe fetcher's guards; throws FeedFetchError. */
  get: (url: string, kind: "robots" | "sitemap" | "page") => Promise<Buffer>;
  sleep: (ms: number) => Promise<void>;
  /** When each known product URL was last seen; unseen and oldest pages are read first. */
  lastSeen?: Map<string, Date>;
  now?: () => number;
  /**
   * Called with the offers parsed since the previous call, every
   * `BATCH_PAGES` pages. The caller saves them, so a run that is cut short
   * (redeploy, crash) keeps what it read. Saved offers are not returned again.
   */
  onBatch?: (batch: ParseResult, progress: { pagesFetched: number; pagesPlanned: number }) => Promise<void>;
  /** Polled between requests; true stops the crawl cleanly (e.g. SIGTERM on redeploy). */
  shouldStop?: () => boolean;
};

/** Pages between saves; at the default 1,5 s delay a cut-short run loses under three minutes. */
export const BATCH_PAGES = 100;

export type ScrapeResult = ParseResult & {
  urlsDiscovered: number;
  pagesFetched: number;
  /** True when every discovered page was read; unseen offers can then be marked out of stock sooner. */
  complete: boolean;
  stopReason?: string;
};

export class ScrapeBlockedError extends Error {}

const STOP_STATUSES = new Set([401, 403, 429, 503]);

function pathAndQuery(u: URL): string {
  return u.pathname + u.search;
}

/** "/p/products/1/Velas+masinas/Bosch/X" → "/p/products/1/Velas masinas/Bosch/X" */
export function decodedPath(u: URL): string {
  try {
    return decodeURIComponent(u.pathname.replace(/\+/g, " "));
  } catch {
    return u.pathname;
  }
}

export function categoryLabel(u: URL, pattern: string | undefined): string | undefined {
  if (!pattern) return undefined;
  const m = decodedPath(u).match(new RegExp(pattern, "i"));
  return m?.[1]?.trim().toLowerCase();
}

export async function scrapeStore(
  config: ScrapeConfig,
  store: AdapterStore,
  deps: ScrapeDeps,
): Promise<ScrapeResult> {
  const now = deps.now ?? Date.now;
  const deadline = now() + config.maxRunMinutes * 60_000;
  const result: ScrapeResult = {
    offers: [],
    rejected: [],
    urlsDiscovered: 0,
    pagesFetched: 0,
    complete: true,
  };
  const host = new URL(config.sitemaps[0]!).hostname;
  const include = config.include.map((r) => new RegExp(r, "i"));
  const exclude = config.exclude.map((r) => new RegExp(r, "i"));

  // 1. robots.txt. Missing (404/410) means no restrictions; anything else unexpected stops the run.
  let robots: RobotsRules = ALLOW_ALL;
  try {
    const body = (await deps.get(`https://${host}/robots.txt`, "robots")).toString("utf8");
    const block = detectBlock(body);
    if (block) throw new ScrapeBlockedError(`${host} serves a bot challenge (${block})`);
    robots = parseRobots(body);
  } catch (err) {
    if (err instanceof FeedFetchError && (err.status === 404 || err.status === 410)) robots = ALLOW_ALL;
    else if (err instanceof FeedFetchError && err.status && STOP_STATUSES.has(err.status)) {
      throw new ScrapeBlockedError(`${host} refused robots.txt with HTTP ${err.status}`);
    } else throw err;
  }
  const delay = Math.max(config.delayMs, (crawlDelaySeconds(robots, ROBOTS_TOKEN) ?? 0) * 1000);
  const allowed = (u: URL) => u.hostname === host && isAllowed(robots, ROBOTS_TOKEN, pathAndQuery(u));

  const politeGet = async (url: string, kind: "sitemap" | "page") => {
    await deps.sleep(delay);
    return deps.get(url, kind);
  };

  // 2. Sitemaps, breadth-first through indexes.
  const candidates = new Map<string, URL>();
  const queue = [...config.sitemaps];
  const seenSitemaps = new Set<string>();
  while (queue.length && seenSitemaps.size < config.maxSitemaps) {
    // The time budget covers sitemap reading too: a slow shop must not overrun it here.
    if (now() > deadline) {
      result.complete = false;
      result.stopReason = "time_budget";
      return result;
    }
    if (deps.shouldStop?.()) {
      result.complete = false;
      result.stopReason = "shutdown";
      return result;
    }
    const next = queue.shift()!;
    if (seenSitemaps.has(next)) continue;
    seenSitemaps.add(next);
    const url = new URL(next);
    if (!allowed(url)) continue;
    let text: string;
    try {
      text = sitemapBodyToText(await politeGet(next, "sitemap"));
    } catch (err) {
      if (err instanceof FeedFetchError && err.status && STOP_STATUSES.has(err.status)) {
        throw new ScrapeBlockedError(`${host} refused a sitemap with HTTP ${err.status}`);
      }
      result.rejected.push({ reason: "sitemap_error", raw: { url: next, error: (err as Error).message } });
      continue;
    }
    const block = detectBlock(text);
    if (block) throw new ScrapeBlockedError(`${host} serves a bot challenge (${block})`);
    const sitemap = parseSitemap(text);
    for (const entry of sitemap.entries) {
      let u: URL;
      try {
        u = new URL(entry.loc);
      } catch {
        continue;
      }
      if (sitemap.kind === "index") {
        if (u.hostname === host) queue.push(u.toString());
        continue;
      }
      const path = u.pathname;
      if (!include.some((r) => r.test(path)) || exclude.some((r) => r.test(path))) continue;
      if (!allowed(u)) continue;
      candidates.set(u.toString(), u);
    }
  }
  if (queue.length) result.complete = false;
  result.urlsDiscovered = candidates.size;

  // 3. Product pages: never-seen first, then the longest-unseen, so a capped run rotates through the catalogue.
  const lastSeen = deps.lastSeen ?? new Map<string, Date>();
  const ordered = [...candidates.values()].sort((a, b) => {
    const ta = lastSeen.get(a.toString())?.getTime() ?? 0;
    const tb = lastSeen.get(b.toString())?.getTime() ?? 0;
    return ta - tb || a.toString().localeCompare(b.toString());
  });
  if (ordered.length > config.maxPages) result.complete = false;
  const pages = ordered.slice(0, config.maxPages);
  const strictStore: AdapterStore = { ...store, strictCategories: true };
  const seenIds = new Set<string>();
  let consecutiveErrors = 0;

  let sinceBatch = 0;
  const flush = async () => {
    if (!deps.onBatch || (result.offers.length === 0 && result.rejected.length === 0)) return;
    const batch: ParseResult = { offers: result.offers.splice(0), rejected: result.rejected.splice(0) };
    await deps.onBatch(batch, { pagesFetched: result.pagesFetched, pagesPlanned: pages.length });
  };

  for (const page of pages) {
    if (now() > deadline) {
      result.complete = false;
      result.stopReason = "time_budget";
      break;
    }
    if (deps.shouldStop?.()) {
      result.complete = false;
      result.stopReason = "shutdown";
      break;
    }
    if (sinceBatch >= BATCH_PAGES) {
      sinceBatch = 0;
      await flush();
    }
    sinceBatch++;
    const pageUrl = page.toString();
    let html: string;
    try {
      html = (await politeGet(pageUrl, "page")).toString("utf8");
      result.pagesFetched++;
    } catch (err) {
      const status = err instanceof FeedFetchError ? err.status : undefined;
      if (status === 404 || status === 410) {
        result.rejected.push({ reason: "gone", raw: pageUrl });
        continue;
      }
      if (status && STOP_STATUSES.has(status)) {
        // The shop asked us to slow down or stop: respect it and keep what we have.
        result.complete = false;
        result.stopReason = `http_${status}`;
        break;
      }
      result.rejected.push({ reason: "fetch_error", raw: { url: pageUrl, error: (err as Error).message } });
      if (++consecutiveErrors >= 5) {
        result.complete = false;
        result.stopReason = "repeated_errors";
        break;
      }
      continue;
    }
    consecutiveErrors = 0;
    const block = detectBlock(html);
    if (block) {
      result.complete = false;
      result.stopReason = block;
      break;
    }
    const records = extractProducts(html, pageUrl);
    if (records.length === 0) {
      result.rejected.push({ reason: "no_product_data", raw: pageUrl });
      continue;
    }
    const label = categoryLabel(page, config.categoryFromUrl);
    for (const record of records) {
      if (record.id && seenIds.has(record.id)) continue;
      if (record.id) seenIds.add(record.id);
      recordToOffer({ ...record, product_type: label }, strictStore, result, pageUrl);
    }
  }
  return result;
}
