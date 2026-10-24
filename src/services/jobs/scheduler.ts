import type { Db } from "@/db/client";
import { eprelClientFromEnv } from "@/services/eprel/client";
import { runEprelJob } from "@/services/eprel/job";
import { renormaliseProducts } from "@/services/ingestion/renormalise";
import { runAllJobs } from "./all";
import { eventful, runHousekeeping } from "./housekeeping";

// In-process scheduler for the web service, so product data arrives without a
// separate Railway cron service. Started from src/instrumentation.ts.

/** On by default on Railway's production environment; INGEST_SCHEDULE=on|off overrides. */
export function schedulerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.INGEST_SCHEDULE === "on") return true;
  if (env.INGEST_SCHEDULE === "off") return false;
  return env.RAILWAY_ENVIRONMENT_NAME === "production";
}

const FIRST_CHECK_MS = 60_000;
const CHECK_EVERY_MS = 15 * 60_000;
/** EPREL lookups per tick: about 240 an hour, gentle on the EU service. */
const EPREL_PER_TICK = 60;

let busy = false;

/** One tick: re-derive attributes after a catalogue change, look up EPREL, ingest the shops that are due, then the follow-up jobs. Never throws. */
export async function tick(db: Db, log: Pick<Console, "log" | "error"> = console): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    // Fast and local: new attribute rules reach stored products before any shop is re-read.
    const renormalised = await renormaliseProducts(db);
    if (renormalised) log.log("attributes: re-derived for", renormalised, "products");
    // Energy-label facts for products in the label categories (docs/ATTRIBUTES.md).
    const eprel = await runEprelJob(db, { client: eprelClientFromEnv(), limit: EPREL_PER_TICK });
    if (eprel.checked) log.log("eprel:", eprel);
    // Visit counts and offers run every tick, also when no shop is due.
    const housekeeping = await runHousekeeping(db);
    if (eventful(housekeeping)) log.log("housekeeping:", JSON.stringify(housekeeping));
    const result = await runAllJobs(db);
    if (!result) return false;
    log.log(
      "ingest scheduler: done",
      result.stores.map((s) => ({
        store: s.storeSlug,
        ok: s.ok,
        upserted: s.rowsUpserted,
        rejected: s.rowsRejected,
        stop: s.stopReason,
        error: s.error,
      })),
    );
    return true;
  } catch (err) {
    log.error("ingest scheduler: run failed", err);
    return false;
  } finally {
    busy = false;
  }
}

export function startIngestScheduler(db: Db): void {
  // A minute after boot, so the health check and first requests come first.
  const timer = setTimeout(function loop() {
    void tick(db).finally(() => setTimeout(loop, CHECK_EVERY_MS).unref());
  }, FIRST_CHECK_MS);
  timer.unref();
  console.log("ingest scheduler: on, every", CHECK_EVERY_MS / 60_000, "min check");
}
