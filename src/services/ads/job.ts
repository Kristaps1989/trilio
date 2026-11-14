import type { Db } from "@/db/client";
import { createCaller } from "@/services/llm/client";
import { searchConsoleFromEnv } from "@/services/seo/search-console";
import { syncReports } from "./account";
import { checkAccount } from "./control";
import { adsProvider } from "./index";
import { runDaily } from "./optimiser";

/** The scheduler's hook: the optimiser once a day after 06:30 Riga time when ads are configured. */
export async function runAdsJob(db: Db, opts: { force?: boolean; now?: Date } = {}) {
  const provider = adsProvider();
  if (!provider) return null;
  return runDaily(db, {
    provider,
    caller: createCaller(db),
    searchConsole: searchConsoleFromEnv(),
    force: opts.force,
    now: opts.now,
  });
}

/** Between reviews: Google's numbers for the last days, at most hourly (docs/GROWTH_PLAN.md). */
export async function runAdsReportSync(db: Db, opts: { force?: boolean; now?: Date } = {}) {
  const provider = adsProvider();
  if (!provider) return null;
  const synced = await syncReports(db, provider, opts);
  // With fresh numbers, also what the account's settings are now, so the page shows drift
  // without anyone pressing "check". A failed read leaves the last check in place.
  if (synced.ok && !("skipped" in synced)) await checkAccount(db, provider, opts.now);
  return synced;
}
