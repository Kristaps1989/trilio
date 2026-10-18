import { desc, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { purgeOldWaitlistLeads } from "@/db/queries/waitlist";
import { ingestionRuns, stores, type Store } from "@/db/schema";
import { ingestStore, isIngestible, type RunResult } from "@/services/ingestion/run";
import { createCaller, extractionEnabled } from "@/services/llm/client";
import { runExtractionJob } from "@/services/llm/extract-job";
import { appBaseUrl } from "@/services/payments";
import { runRadarJob } from "@/services/radar/job";
import { radarTexts } from "@/services/texts";

// The scheduled job: every shop that is due, then attribute extraction, the
// price radar and data retention. Run by the web service's own scheduler
// (scheduler.ts) or by the optional Railway cron service (`npm run ingest -- all`).
// Each shop is scheduled on its own, so one shop's crash or slow run never
// holds the others back.

/** Hours between runs of the same shop. */
export const INGEST_INTERVAL_HOURS = 4;
/** Added to a store's time budget before an unfinished run counts as dead. */
const SAVE_SLACK_MINUTES = 15;
/** Feeds are one download; this is their budget for the dead-run rule. */
const FEED_BUDGET_MINUTES = 30;

export type RunRow = { startedAt: Date; finishedAt: Date | null };

export function runBudgetMinutes(store: Pick<Store, "feedType" | "scrapeConfig">): number {
  if (store.feedType !== "scrape") return FEED_BUDGET_MINUTES;
  const n = (store.scrapeConfig as { maxRunMinutes?: unknown } | null)?.maxRunMinutes;
  return typeof n === "number" && n > 0 ? n : 90;
}

/**
 * A store is due when it has no live run and its last finished run is older
 * than the interval. An unfinished run older than the store's time budget
 * (plus slack for saving) died with its process, e.g. in a redeploy, and no
 * longer blocks a new one.
 */
export function isDue(
  store: Pick<Store, "feedType" | "scrapeConfig">,
  runs: RunRow[],
  now: Date,
  hours = INGEST_INTERVAL_HOURS,
): boolean {
  const aliveAfter = now.getTime() - (runBudgetMinutes(store) + SAVE_SLACK_MINUTES) * 60_000;
  if (runs.some((r) => r.finishedAt === null && r.startedAt.getTime() > aliveAfter)) return false;
  const lastFinished = Math.max(0, ...runs.map((r) => r.finishedAt?.getTime() ?? 0));
  return lastFinished <= now.getTime() - hours * 3_600_000;
}

/** Ingestible stores that are due now. */
export async function dueStores(db: Db, now = new Date()): Promise<Store[]> {
  const list = (await db.select().from(stores)).filter((s) => isIngestible(s));
  if (list.length === 0) return [];
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const runs = await db
    .select({
      storeId: ingestionRuns.storeId,
      startedAt: ingestionRuns.startedAt,
      finishedAt: ingestionRuns.finishedAt,
    })
    .from(ingestionRuns)
    .where(gt(ingestionRuns.startedAt, since))
    .orderBy(desc(ingestionRuns.startedAt));
  return list.filter((s) =>
    isDue(
      s,
      runs.filter((r) => r.storeId === s.id),
      now,
    ),
  );
}

export type AllJobsResult = {
  stores: RunResult[];
  extraction: unknown;
  radar: unknown;
  waitlistPurged: number;
};

/**
 * Ingests the due stores (or every ingestible store with `force`), then the
 * follow-up jobs. Returns null when no store was due, so callers stay quiet.
 */
export async function runAllJobs(db: Db, opts: { force?: boolean } = {}): Promise<AllJobsResult | null> {
  const targets = opts.force
    ? (await db.select().from(stores)).filter((s) => isIngestible(s))
    : await dueStores(db);
  if (targets.length === 0) return null;
  console.log(`ingest: starting ${targets.map((s) => s.slug).join(", ")}`);
  const results: RunResult[] = [];
  // One store at a time: a shop's pages are read politely and in sequence anyway.
  for (const store of targets) results.push(await ingestStore(db, store));
  // New products get attributes when extraction is on (docs/LLM.md).
  const extraction = extractionEnabled() ? await runExtractionJob(db, createCaller(db)) : null;
  const radar = await runRadarJob(db, { baseUrl: appBaseUrl(), texts: radarTexts() });
  // Privacy policy retention: waitlist entries older than 12 months.
  const waitlistPurged = await purgeOldWaitlistLeads(db);
  return { stores: results, extraction, radar, waitlistPurged };
}
