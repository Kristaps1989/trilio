import { eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ingestionRuns, offers, products, stores, type Store } from "@/db/schema";
import { csvAdapter } from "./csv";
import { fetchBytes, fetchFeed, type FetchFeedOptions } from "./fetch";
import { googleXmlAdapter } from "./google-xml";
import { sampleAdapter } from "./sample";
import { ROBOTS_TOKEN, ScrapeConfigSchema, scrapeStore, type ScrapeDeps } from "./scrape/crawler";
import type { FeedAdapter, ParseResult } from "./types";
import { stopRequested } from "./shutdown";
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
  /** Stop check for scraped stores (tests); defaults to the process shutdown flag. */
  shouldStop?: () => boolean;
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
  // Saves one batch of parsed offers and records progress on the run, so
  // /api/status and the logs show a live run and a cut-short run keeps its work.
  const save = async (batch: ParseResult) => {
    result.rowsRead += batch.offers.length + batch.rejected.length;
    result.rowsRejected += batch.rejected.length;
    if (result.rejectedSample.length < 20) {
      result.rejectedSample.push(...batch.rejected.slice(0, 20 - result.rejectedSample.length));
    }
    const stats = await upsertOffers(db, store, batch.offers, now);
    result.rowsUpserted += stats.offersUpserted;
    result.productsCreated += stats.productsCreated;
    await db
      .update(ingestionRuns)
      .set({
        rowsRead: result.rowsRead,
        rowsUpserted: result.rowsUpserted,
        rowsRejected: result.rowsRejected,
      })
      .where(eq(ingestionRuns.id, run!.id));
  };
  try {
    let graceHours = GRACE_HOURS_FULL_RUN;
    if (store.feedType === "scrape") {
      const config = ScrapeConfigSchema.parse(store.scrapeConfig ?? {});
      const deps = await scrapeDeps(db, store, opts);
      const scraped = await scrapeStore(
        config,
        { slug: store.slug, categoryMap: store.categoryMap },
        {
          ...deps,
          onBatch: async (batch, progress) => {
            await save(batch);
            console.log(
              `ingest ${store.slug}: ${progress.pagesFetched}/${progress.pagesPlanned} pages, ${result.rowsUpserted} offers saved`,
            );
          },
          shouldStop: opts.shouldStop ?? stopRequested,
        },
      );
      await save(scraped);
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
      await save(adapter.parse(body, { slug: store.slug, categoryMap: store.categoryMap }));
    }
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
    .select({ url: offers.url, lastSeenAt: offers.lastSeenAt, hasSpecs: isNotNull(products.specTable) })
    .from(offers)
    .innerJoin(products, eq(products.id, offers.productId))
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
    // Pages read before spec tables were stored count as never seen, so they are re-read first.
    lastSeen: new Map(known.map((k) => [k.url, k.hasSpecs ? k.lastSeenAt : new Date(0)])),
    ...opts.scrapeDeps,
  };
}

function requireFeedUrl(store: Store): string {
  if (!store.feedUrl) throw new Error(`store ${store.slug} has no feed_url`);
  return store.feedUrl;
}

/** Stores that real ingestion handles: active, not sample data, with a feed URL or scrape config. */
export function isIngestible(store: Store, skip: Store["feedType"][] = []): boolean {
  if (!store.active || store.feedType === "sample" || skip.includes(store.feedType)) return false;
  return store.feedType === "scrape" ? !!store.scrapeConfig : !!store.feedUrl;
}

/** All active stores with a feed or scrape config, excluding sample data. */
export async function ingestAllActive(
  db: Db,
  opts: RunOptions & { only?: (store: Store) => boolean } = {},
): Promise<RunResult[]> {
  const list = await db.select().from(stores).where(eq(stores.active, true));
  const results: RunResult[] = [];
  for (const store of list) {
    if (!isIngestible(store, opts.skipFeedTypes)) continue;
    if (opts.only && !opts.only(store)) continue;
    results.push(await ingestStore(db, store, opts));
  }
  return results;
}
