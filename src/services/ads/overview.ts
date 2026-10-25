import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { adAgentRuns, adDailyStats } from "@/db/schema";
import { costPerConversion } from "@/domain/ads/budget";
import { ACCOUNT_ENTITY, dayOffset, getSettings, performance } from "./account";
import { nextReviewDay } from "./optimiser";

/** The numbers on Reklāma → Pārskats. */
export async function adsOverview(db: Db, now = new Date()) {
  const settings = await getSettings(db);
  const monthStart = `${dayOffset(now, 0).slice(0, 7)}-01`;
  // Spend as Google's overview shows it: the account total when Google reported one, else the campaigns.
  const sum = async (from: string, level: "account" | "campaign") => {
    const [r] = await db
      .select({
        micros: sql<number>`coalesce(sum(${adDailyStats.costMicros}), 0)::bigint`,
        clicks: sql<number>`coalesce(sum(${adDailyStats.clicks}), 0)::int`,
        rows: sql<number>`count(*)::int`,
      })
      .from(adDailyStats)
      .where(
        and(
          eq(adDailyStats.level, level),
          level === "account" ? eq(adDailyStats.entityId, ACCOUNT_ENTITY) : undefined,
          gte(adDailyStats.day, from),
          lte(adDailyStats.day, dayOffset(now, 0)),
        ),
      );
    return { micros: Number(r?.micros ?? 0), clicks: Number(r?.clicks ?? 0), rows: Number(r?.rows ?? 0) };
  };
  const spend = async (from: string) => {
    const [account, campaigns] = await Promise.all([sum(from, "account"), sum(from, "campaign")]);
    const total = account.rows > 0 ? account : campaigns;
    return {
      micros: total.micros,
      clicks: total.clicks,
      /** Spent by campaigns Trilio does not manage (made in Google Ads directly). */
      outsideMicros: Math.max(0, account.micros - campaigns.micros),
    };
  };
  const [today, week, month, perf, [lastRun]] = await Promise.all([
    spend(dayOffset(now, 0)),
    spend(dayOffset(now, 6)),
    spend(monthStart),
    performance(db, now),
    db
      .select()
      .from(adAgentRuns)
      .where(eq(adAgentRuns.kind, "daily"))
      .orderBy(desc(adAgentRuns.startedAt))
      .limit(1),
  ]);
  const ranToday = lastRun?.day === dayOffset(now, 0);
  return {
    settings,
    today,
    week,
    month,
    perf,
    cpa: costPerConversion(perf, settings),
    lastRun: lastRun ?? null,
    nextReview: nextReviewDay(settings, now, ranToday),
  };
}
