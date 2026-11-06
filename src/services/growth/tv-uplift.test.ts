import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { affiliateClicks, tvCampaigns, tvUplift, visits, visitSalts } from "@/db/schema";
import { BUCKETS } from "@/domain/growth/uplift";
import {
  computeTvUpliftDay,
  createTvCampaign,
  ensureTvBaseline,
  firstImpressionDay,
  getTvCampaign,
  recordTvImpression,
  rollupTvUplift,
  tvReport,
} from "./tv";

// The TV uplift against the database (docs/TV_ANALYTICS_PLAN.md): impressions
// per minute, the baseline from the days before, the day's figures, the
// nightly rollup and the report.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const SLUG = "tvtest-go3-uplift";
/** 2031-05-06 (summer time, UTC+3) at Riga hh:mm. */
const riga = (dd: number, hh: number, mm: number) => new Date(Date.UTC(2031, 4, dd, hh - 3, mm));
const DAY = "2031-05-06";

run("TV uplift", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  const wipe = async () => {
    await db.delete(tvCampaigns).where(sql`${tvCampaigns.slug} like 'tvtest-go3-uplift%'`);
    await db.delete(visits).where(sql`${visits.visitorHash} like 'unit-tv-%'`);
    await db.delete(visitSalts).where(sql`${visitSalts.day} between '2031-04-20' and '2031-05-10'`);
    await db.delete(affiliateClicks).where(sql`${affiliateClicks.visitorHash} like 'unit-tv-%'`);
  };
  const view = (day: string, at: Date, visitor: string, section = "home", client = "Chrome Android") =>
    db.insert(visits).values({
      day,
      path: "/",
      section,
      subcategory: null,
      visitorHash: `unit-tv-${visitor}`,
      client,
      createdAt: at,
    });
  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    await wipe();
    await createTvCampaign(db, { name: "Unit uplift", slug: SLUG });
    // Two baseline days with one session at 20:00–20:09 each, one at 21:00; one empty day in between.
    await view("2031-05-03", riga(3, 20, 2), "b1");
    await view("2031-05-03", riga(3, 21, 2), "b2");
    await view("2031-05-05", riga(5, 20, 7), "b3");
    // The campaign day: impressions at 20:01 and 20:03 (no device id, so no viewer rows: tv.test.ts counts those); sessions at 20:05 (results, phone), 20:12 (desktop),
    // one page view at 20:20 by the 20:05 visitor (same session), one at 09:00; a shop click at 20:15.
    const imp = (at: Date, vid: string) =>
      recordTvImpression(db, { slug: SLUG, vid: null, ip: null, userAgent: vid, now: at });
    await imp(riga(6, 20, 1), "d1");
    await imp(riga(6, 20, 1), "d2");
    await imp(riga(6, 20, 3), "d3");
    await view(DAY, riga(6, 20, 5), "c1", "flow");
    await view(DAY, riga(6, 20, 20), "c1", "results");
    await view(DAY, riga(6, 20, 12), "c2", "home", "Chrome Windows");
    await view(DAY, riga(6, 9, 0), "c3");
    await db
      .insert(affiliateClicks)
      .values({
        offerId:
          (await db
            .execute(sql`select id from offers limit 1`)
            .then((r) => (r as unknown as { id: string }[])[0]?.id)) ??
          "00000000-0000-0000-0000-000000000000",
        visitorHash: "unit-tv-c1",
        clickedAt: riga(6, 20, 15),
      })
      .catch(() => undefined);
  });
  afterAll(async () => {
    await wipe();
    await end();
  });

  it("counts impressions per minute and knows the first day", async () => {
    const rows = await db.execute(
      sql`select minute, hits from tv_impressions where slug = ${SLUG} order by minute`,
    );
    expect((rows as unknown as { hits: number }[]).map((r) => Number(r.hits))).toEqual([2, 1]);
    expect(await firstImpressionDay(db, SLUG)).toBe(DAY);
  });

  it("sets the baseline once from the days before the first impression", async () => {
    const campaign = (await getTvCampaign(db, SLUG))!;
    const baseline = (await ensureTvBaseline(db, campaign))!;
    expect(baseline.from).toBe("2031-04-22");
    expect(baseline.to).toBe("2031-05-05");
    expect(baseline.days).toBe(2);
    expect(baseline.sessions).toHaveLength(BUCKETS);
    expect(baseline.sessions[120]).toBe(1); // 20:00 on both days
    expect(baseline.sessions[126]).toBe(0.5); // 21:00 on one of two
    const again = (await getTvCampaign(db, SLUG))!;
    expect(again.baseline).toEqual(baseline);
    expect(await ensureTvBaseline(db, again)).toEqual(baseline);
  });

  it("computes a day's figures from the raw data", async () => {
    const campaign = (await getTvCampaign(db, SLUG))!;
    const u = await computeTvUpliftDay(db, campaign, DAY);
    expect(u.impressions).toBe(3);
    expect(u.tvBuckets).toBe(2);
    expect(u.sessionsDay).toBe(3);
    expect(u.sessionsAfter).toBe(2);
    expect(u.expectedAfter).toBe(1);
    expect(u.uplift).toBe(1);
    expect(u.resultsAfter).toBe(1);
    expect(u.phoneAfter).toBe(1);
    expect(u.buckets[120]).toEqual([3, 1]);
    expect(u.buckets[121]).toEqual([0, 1]);
  });

  it("stores finished days in the rollup, idempotently, and reports them", async () => {
    const now = new Date("2031-05-08T10:00:00Z");
    expect(await rollupTvUplift(db, now)).toBe(1);
    expect(await rollupTvUplift(db, now)).toBe(1); // the last days are recomputed, same result
    const [row] = await db
      .select()
      .from(tvUplift)
      .where(sql`${tvUplift.slug} = ${SLUG}`);
    expect(row?.sessionsAfter).toBe(2);
    expect(row?.uplift).toBe(1);
    const report = (await tvReport(db, SLUG, now))!;
    expect(report.days.map((d) => [d.day, d.live, d.sessionsAfter])).toEqual([[DAY, false, 2]]);
    expect(report.summary.sessionsAfter).toBe(2);
    expect(report.summary.expectedAfter).toBe(1);
    expect(report.summary.uplift).toBe(1);
    expect(report.summary.upliftPct).toBe(100);
    expect(report.summary.profile.impressions[120]).toBe(3);
    expect(report.baseline?.days).toBe(2);
    // Today is computed live.
    const live = (await tvReport(db, SLUG, new Date("2031-05-06T19:00:00Z")))!;
    expect(live.days.map((d) => [d.day, d.live])).toEqual([[DAY, true]]);
  });

  it("drops the figures with the campaign", async () => {
    await db.delete(tvCampaigns).where(sql`${tvCampaigns.slug} = ${SLUG}`);
    const rows = await db.execute(sql`select 1 from tv_uplift where slug = ${SLUG}`);
    expect((rows as unknown as unknown[]).length).toBe(0);
    expect(await tvReport(db, SLUG)).toBeNull();
  });
});
