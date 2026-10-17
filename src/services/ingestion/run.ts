import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ingestionRuns, stores, type Store } from "@/db/schema";
import { csvAdapter } from "./csv";
import { fetchFeed, type FetchFeedOptions } from "./fetch";
import { googleXmlAdapter } from "./google-xml";
import { sampleAdapter } from "./sample";
import type { FeedAdapter } from "./types";
import { markUnseenOutOfStock, upsertOffers } from "./upsert";

// One ingestion run for one store: fetch → parse → upsert → mark unseen.
// Every run is recorded in ingestion_runs so the ops runbook can see what
// each store delivered and why rows were rejected.

const ADAPTERS: Record<Store["feedType"], FeedAdapter | null> = {
  sample: sampleAdapter,
  google_xml: googleXmlAdapter,
  csv: csvAdapter,
  api: null, // per-store adapters are registered here when a partner exposes an API
};

export type RunOptions = {
  /** Replaces the network fetch (tests, local files). */
  loadBody?: (store: Store) => Promise<string>;
  fetchOptions?: Partial<FetchFeedOptions>;
  now?: Date;
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
    const adapter = ADAPTERS[store.feedType];
    if (!adapter) throw new Error(`no adapter for feed type ${store.feedType}`);
    const body = opts.loadBody
      ? await opts.loadBody(store)
      : await fetchFeed(requireFeedUrl(store), {
          allowedHosts: [new URL(requireFeedUrl(store)).hostname, ...store.feedAllowedHosts],
          ...opts.fetchOptions,
        });
    const parsed = adapter.parse(body, { slug: store.slug, categoryMap: store.categoryMap });
    result.rowsRead = parsed.offers.length + parsed.rejected.length;
    result.rowsRejected = parsed.rejected.length;
    result.rejectedSample = parsed.rejected.slice(0, 20);
    const stats = await upsertOffers(db, store, parsed.offers, now);
    result.rowsUpserted = stats.offersUpserted;
    result.productsCreated = stats.productsCreated;
    result.markedOut = await markUnseenOutOfStock(db, store, now);
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

function requireFeedUrl(store: Store): string {
  if (!store.feedUrl) throw new Error(`store ${store.slug} has no feed_url`);
  return store.feedUrl;
}

/** All active stores with a feed, excluding sample data. */
export async function ingestAllActive(db: Db, opts: RunOptions = {}): Promise<RunResult[]> {
  const list = await db.select().from(stores).where(eq(stores.active, true));
  const results: RunResult[] = [];
  for (const store of list) {
    if (store.feedType === "sample" || !store.feedUrl) continue;
    results.push(await ingestStore(db, store, opts));
  }
  return results;
}
