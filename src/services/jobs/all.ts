import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { purgeOldWaitlistLeads } from "@/db/queries/waitlist";
import { ingestAllActive, type RunResult } from "@/services/ingestion/run";
import { createCaller, extractionEnabled } from "@/services/llm/client";
import { runExtractionJob } from "@/services/llm/extract-job";
import { appBaseUrl } from "@/services/payments";
import { runRadarJob } from "@/services/radar/job";
import { radarTexts } from "@/services/texts";

// The four-hourly job: every active shop, then attribute extraction, the
// price radar and data retention. Run by the web service's own scheduler
// (scheduler.ts) or by the optional Railway cron service (`npm run ingest -- all`).

/** Hours between runs; also the window in which a started run blocks another. */
export const INGEST_INTERVAL_HOURS = 4;

/**
 * True when a run is still going or one finished within the interval. Keeps
 * the web scheduler and a cron service from scraping the same shops twice.
 * An unfinished run older than its store's time budget (maxRunMinutes, plus
 * slack for saving) died with its process, e.g. in a redeploy, and no longer
 * blocks a new one.
 */
export async function ingestRecentlyRan(db: Db, hours = INGEST_INTERVAL_HOURS): Promise<boolean> {
  const rows = await db.execute(sql`
    select 1 from ingestion_runs r join stores s on s.id = r.store_id
    where r.finished_at > now() - make_interval(hours => ${hours})
       or (r.finished_at is null and r.started_at > now() - make_interval(
             mins => coalesce((s.scrape_config ->> 'maxRunMinutes')::int, 90) + 15))
    limit 1
  `);
  return rows.length > 0;
}

export type AllJobsResult = {
  stores: RunResult[];
  extraction: unknown;
  radar: unknown;
  waitlistPurged: number;
};

export async function runAllJobs(db: Db): Promise<AllJobsResult> {
  const stores = await ingestAllActive(db);
  // New products get attributes when extraction is on (docs/LLM.md).
  const extraction = extractionEnabled() ? await runExtractionJob(db, createCaller(db)) : null;
  const radar = await runRadarJob(db, { baseUrl: appBaseUrl(), texts: radarTexts() });
  // Privacy policy retention: waitlist entries older than 12 months.
  const waitlistPurged = await purgeOldWaitlistLeads(db);
  return { stores, extraction, radar, waitlistPurged };
}
