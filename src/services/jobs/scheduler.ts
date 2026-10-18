import type { Db } from "@/db/client";
import { ingestRecentlyRan, runAllJobs } from "./all";

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

let busy = false;

/** One tick: run the jobs unless a run started within the interval. Never throws. */
export async function tick(db: Db, log: Pick<Console, "log" | "error"> = console): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    if (await ingestRecentlyRan(db)) return false;
    log.log("ingest scheduler: starting run");
    const result = await runAllJobs(db);
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
