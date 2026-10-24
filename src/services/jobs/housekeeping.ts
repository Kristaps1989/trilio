import type { Db } from "@/db/client";
import { offerMailDeps } from "@/services/offers/deps";
import { runOffersJob, type OffersJobResult } from "@/services/offers/job";
import { trackersFromEnv } from "@/services/offers/tracking";
import { rollupVisits } from "@/services/visits/visits";

// Runs on every scheduler tick, independent of the shops' ingestion: visit
// rollup and retention, and the offers job (expiry, the reminder,
// "Viss kārtībā?", carrier tracking). Each part is idempotent.

export type HousekeepingResult = { visits: { days: number; purged: number }; offers: OffersJobResult };

export async function runHousekeeping(db: Db, now = new Date()): Promise<HousekeepingResult> {
  const visits = await rollupVisits(db, now);
  const offers = await runOffersJob(db, { ...offerMailDeps(), trackers: trackersFromEnv(), now });
  return { visits, offers };
}

export function eventful(r: HousekeepingResult): boolean {
  return r.visits.purged > 0 || Object.values(r.offers).some((n) => n > 0);
}
