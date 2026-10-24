import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { adAgentRuns, adDailyStats } from "@/db/schema";
import { costPerConversion } from "@/domain/ads/budget";
import { dayOffset, getSettings, performance } from "./account";

/** The numbers on Reklāma → Pārskats. */
export async function adsOverview(db: Db, now = new Date()) {
  const settings = await getSettings(db);
  const monthStart = `${dayOffset(now, 0).slice(0, 7)}-01`;
  const sum = async (from: string) => {
    const [r] = await db
      .select({
        micros: sql<number>`coalesce(sum(${adDailyStats.costMicros}), 0)::bigint`,
        clicks: sql<number>`coalesce(sum(${adDailyStats.clicks}), 0)::int`,
      })
      .from(adDailyStats)
      .where(
        and(
          eq(adDailyStats.level, "campaign"),
          gte(adDailyStats.day, from),
          lte(adDailyStats.day, dayOffset(now, 0)),
        ),
      );
    return { micros: Number(r?.micros ?? 0), clicks: Number(r?.clicks ?? 0) };
  };
  const [week, month, perf, [lastRun]] = await Promise.all([
    sum(dayOffset(now, 7)),
    sum(monthStart),
    performance(db, now),
    db
      .select()
      .from(adAgentRuns)
      .where(eq(adAgentRuns.kind, "daily"))
      .orderBy(desc(adAgentRuns.startedAt))
      .limit(1),
  ]);
  return { settings, week, month, perf, cpa: costPerConversion(perf, settings), lastRun: lastRun ?? null };
}
