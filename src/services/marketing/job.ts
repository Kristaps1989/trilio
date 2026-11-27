import type { Db } from "@/db/client";
import { adsProvider } from "@/services/ads";
import { runMarketingDaily } from "./manager";
import { metaAdsFromEnv } from "./meta-ads";
import { adRenderer, creatorConfigFromEnv } from "./meta-creator";

/** The hour (Riga) after which the day's round runs: before the Google optimiser at 06:30. */
export const MARKETING_RUN_HOUR = 6;

const rigaHour = (d: Date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Riga", hour: "2-digit", hourCycle: "h23" }).format(
      d,
    ),
  );

/**
 * The scheduler's hook for the marketing manager (services/marketing/manager.ts): once a day
 * from 06:00 Riga time, when one budget serves Google and Meta and Meta's account is set up.
 */
export async function runMarketingJob(db: Db, opts: { force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  if (!opts.force && rigaHour(now) < MARKETING_RUN_HOUR) return null;
  const config = creatorConfigFromEnv();
  return runMarketingDaily(db, {
    meta: metaAdsFromEnv(),
    google: adsProvider(),
    creator: config ? { config, render: adRenderer() } : null,
    now,
    force: opts.force,
  });
}
