import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ingestionRuns, offers, stores, type Store } from "@/db/schema";
import { csvAdapter } from "./csv";
import { fetchBytes, fetchFeed, type FetchFeedOptions } from "./fetch";
import { googleXmlAdapter } from "./google-xml";
import { sampleAdapter } from "./sample";
import { ROBOTS_TOKEN, ScrapeConfigSchema, scrapeStore, type ScrapeDeps } from "./scrape/crawler";
import type { FeedAdapter, ParseResult } from "./types";
import { markUnseenOutOfStock, upsertOffers } from "./upsert";

// One ingestion run for one store: fetch → parse → upsert → mark unseen.
// Every run is recorded in ingestion_runs so the ops runbook can see what
// each store delivered and why rows were rejected.

const ADAPTERS: Record<Exclude<Store["feedType"], "scrape">, FeedAdapter | null> = {
  sample: sampleAdapter,
  google_xml: googleXmlAdapter,
  csv: csvAdapter,
  api: null, // per-store adapters are registered here when a partner exposes an API
};

/** Honest identification: shops can see who we are and block or contact us. */
export function scraperUserAgent(): string {
  const site = process.env.APP_URL ?? "https://trilio.lv";
  return `Mozilla/5.0 (compatible; ${ROBOTS_TOKEN}/1.0; +${site})`;
}

/** Hours an offer may go unseen before it counts as out of stock (full runs). */
const GRACE_HOURS_FULL_RUN = 24;

export type RunOptions = {
  /** Replaces the network fetch (tests, local files). */
  loadBody?: (store: Store) => Promise<string>;
  fetchOptions?: Partial<FetchFeedOptions>;
  /** Replaces network and timers for scraped stores (tests). */
  scrapeDeps?: Partial<ScrapeDeps>;
  now?: Date;
  /** Feed types to leave out, e.g. the HTTP cron route skips long scrapes. */
  skipFeedTypes?: Store["feedType"][];
};

export type RunResult = {
  storeSlug: string;
  ok: boolean;
  rowsRead: number;
  rowsUpserted: number;
  rowsRejected: number;
  markedOut: number;
  productsCreated: number;
  error?: string;
  /** Scraped stores: pages read and why the crawl stopped early, if it did. */
  pagesFetched?: number;
  stopReason?: string;
  rejectedSample: { reason: string; raw: unknown }[];
};

export async function ingestStore(db: Db, store: Store, opts: RunOptions = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const [run] = await db
    .insert(ingestionRuns)
    .values({ storeId: store.id, startedAt: now })
    .returning({ id: ingestionRuns.id });
  const result: RunResult = {
    storeSlug: store.slug,
    ok: false,
    rowsRead: 0,
    rowsUpserted: 0,
    rowsRejected: 0,
    markedOut: 0,
    productsCreated: 0,
    rejectedSample: [],
  };
  try {
    let parsed: ParseResult;
    let graceHours = GRACE_HOURS_FULL_RUN;
    if (store.feedType === "scrape") {
      const config = ScrapeConfigSchema.parse(store.scrapeConfig ?? {});
      const scraped = await scrapeStore(
        config,
        { slug: store.slug, categoryMap: store.categoryMap },
        await scrapeDeps(db, store, opts),
      );
      parsed = scraped;
      result.pagesFetched = scraped.pagesFetched;
      result.stopReason = scraped.stopReason;
      if (!scraped.complete) graceHours = config.staleAfterHours;
    } else {
      const adapter = ADAPTERS[store.feedType];
      if (!adapter) throw new Error(`no adapter for feed type ${store.feedType}`);
      const body = opts.loadBody
        ? await opts.loadBody(store)
        : await fetchFeed(requireFeedUrl(store), {
            allowedHosts: [new URL(requireFeedUrl(store)).hostname, ...store.feedAllowedHosts],
            ...opts.fetchOptions,
          });
      parsed = adapter.parse(body, { slug: store.slug, categoryMap: store.categoryMap });
    }
    result.rowsRead = parsed.offers.length + parsed.rejected.length;
    result.rowsRejected = parsed.rejected.length;
    result.rejectedSample = parsed.rejected.slice(0, 20);
    const stats = await upsertOffers(db, store, parsed.offers, now);
    result.rowsUpserted = stats.offersUpserted;
    result.productsCreated = stats.productsCreated;
    result.markedOut = await markUnseenOutOfStock(db, store, now, graceHours);
    result.ok = true;
    await db.update(stores).set({ lastIngestedAt: now }).where(eq(stores.id, store.id));
  } catch (err) {
    result.error = (err as Error).message;
  } finally {
    await db
      .update(ingestionRuns)
      .set({
        finishedAt: new Date(),
        ok: result.ok,
        rowsRead: result.rowsRead,
        rowsUpserted: result.rowsUpserted,
        rowsRejected: result.rowsRejected,
        error: result.error ?? null,
      })
      .where(eq(ingestionRuns.id, run!.id));
  }
  return result;
}

async function scrapeDeps(db: Db, store: Store, opts: RunOptions): Promise<ScrapeDeps> {
  const known = await db
    .select({ url: offers.url, lastSeenAt: offers.lastSeenAt })
    .from(offers)
    .where(eq(offers.storeId, store.id));
  const config = ScrapeConfigSchema.parse(store.scrapeConfig ?? {});
  const host = new URL(config.sitemaps[0]!).hostname;
  return {
    get: (url, kind) =>
      fetchBytes(url, {
        allowedHosts: [host, ...store.feedAllowedHosts],
        accept:
          kind === "page" ? "text/html,application/xhtml+xml" : "application/xml, text/xml, text/plain;q=0.8",
        userAgent: scraperUserAgent(),
        maxBytes: kind === "page" ? 5 * 1024 * 1024 : 50 * 1024 * 1024,
        timeoutMs: 30_000,
        ...opts.fetchOptions,
      }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    lastSeen: new Map(known.map((k) => [k.url, k.lastSeenAt])),
    ...opts.scrapeDeps,
  };
}

function requireFeedUrl(store: Store): string {
  if (!store.feedUrl) throw new Error(`store ${store.slug} has no feed_url`);
  return store.feedUrl;
}

/** All active stores with a feed or scrape config, excluding sample data. */
export async function ingestAllActive(db: Db, opts: RunOptions = {}): Promise<RunResult[]> {
  const list = await db.select().from(stores).where(eq(stores.active, true));
  const results: RunResult[] = [];
  for (const store of list) {
    if (store.feedType === "sample" || opts.skipFeedTypes?.includes(store.feedType)) continue;
    if (store.feedType === "scrape" ? !store.scrapeConfig : !store.feedUrl) continue;
    results.push(await ingestStore(db, store, opts));
  }
  return results;
}
