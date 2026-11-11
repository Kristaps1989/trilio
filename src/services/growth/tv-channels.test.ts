import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { adLandings, tvCampaigns, visits } from "@/db/schema";
import {
  CHANNEL_FILTER,
  computeTvUpliftDay,
  createTvCampaign,
  dayChannelMix,
  ensureTvBaseline,
  getTvCampaign,
  recordTvImpression,
  rollupTvUplift,
} from "./tv";

// The TV uplift counts only the channels TV can cause (docs/TV_ANALYTICS_PLAN.md §8):
// direct, the TV link and Google brand searches. A visitor who landed from a Meta or a
// non-brand Google ad is shown in the channel mix, but never counted as TV's effect,
// on the campaign day or in the baseline.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const SLUG = "tvtest-channels";
/** 2031-06 (summer time, UTC+3) at Riga hh:mm. */
const riga = (dd: number, hh: number, mm: number) => new Date(Date.UTC(2031, 5, dd, hh - 3, mm));
const BASE_DAY = "2031-06-08";
const DAY = "2031-06-10";

run("TV channels", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  const wipe = async () => {
    await db.delete(tvCampaigns).where(sql`${tvCampaigns.slug} = ${SLUG}`);
    await db.delete(visits).where(sql`${visits.visitorHash} like 'unit-tvch-%'`);
    await db.delete(adLandings).where(sql`${adLandings.visitorHash} like 'unit-tvch-%'`);
  };
  const view = (day: string, at: Date, visitor: string) =>
    db.insert(visits).values({
      day,
      path: "/",
      section: "home",
      subcategory: null,
      visitorHash: `unit-tvch-${visitor}`,
      client: "Chrome Android",
      createdAt: at,
    });
  const landing = (day: string, visitor: string, tags: Partial<typeof adLandings.$inferInsert>) =>
    db.insert(adLandings).values({ day, visitorHash: `unit-tvch-${visitor}`, path: "/", ...tags });

  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    await wipe();
    await createTvCampaign(db, { name: "Unit channels", slug: SLUG });
    // Baseline day: one direct session and one Meta ad session at 20:0x.
    await view(BASE_DAY, riga(8, 20, 2), "b-direct");
    await view(BASE_DAY, riga(8, 20, 3), "b-meta");
    await landing(BASE_DAY, "b-meta", { utmSource: "facebook", utmMedium: "paid" });
    // Campaign day: an impression at 20:01, then direct, Google brand, Meta ad and Google
    // non-brand sessions in the minutes after it.
    await recordTvImpression(db, { slug: SLUG, vid: null, ip: null, userAgent: "d1", now: riga(10, 20, 1) });
    await view(DAY, riga(10, 20, 4), "direct");
    await view(DAY, riga(10, 20, 5), "brand");
    await landing(DAY, "brand", { gclid: "Cj0KCQunitbrand", utmTerm: "trilio" });
    await view(DAY, riga(10, 20, 6), "meta");
    await landing(DAY, "meta", { utmSource: "facebook", utmMedium: "paid" });
    await view(DAY, riga(10, 20, 7), "google");
    await landing(DAY, "google", { gclid: "Cj0KCQunitgeneric", utmTerm: "tējkannas" });
  });
  afterAll(async () => {
    await wipe();
    await end();
  });

  it("draws the baseline on the eligible channels only", async () => {
    const baseline = (await ensureTvBaseline(db, (await getTvCampaign(db, SLUG))!))!;
    expect(baseline.filter).toBe(CHANNEL_FILTER);
    expect(baseline.days).toBe(1);
    expect(baseline.sessions[120]).toBe(1); // the direct session, not the Meta one
  });

  it("counts TV's effect without paid Meta and non-brand Google visitors, and shows them in the mix", async () => {
    const u = await computeTvUpliftDay(db, (await getTvCampaign(db, SLUG))!, DAY);
    expect(u.sessionsDay).toBe(2);
    expect(u.sessionsAfter).toBe(2);
    expect(await dayChannelMix(db, DAY)).toMatchObject({
      direct: 1,
      google_brand: 1,
      meta_ads: 1,
      google: 1,
    });
  });

  it("redraws a baseline from before the filter once, while its raw visits are kept", async () => {
    const campaign = (await getTvCampaign(db, SLUG))!;
    const old = {
      ...campaign.baseline!,
      filter: undefined,
      sessions: campaign.baseline!.sessions.map(() => 2),
    };
    await db.update(tvCampaigns).set({ baseline: old }).where(eq(tvCampaigns.slug, SLUG));
    await rollupTvUplift(db, new Date("2031-06-12T10:00:00Z"));
    const redrawn = (await getTvCampaign(db, SLUG))!.baseline!;
    expect(redrawn.filter).toBe(CHANNEL_FILTER);
    expect(redrawn.sessions[120]).toBe(1);
    const [row] = await db.execute(sql`select channels from tv_uplift where slug = ${SLUG}`);
    expect((row as { channels: Record<string, number> }).channels).toMatchObject({ meta_ads: 1 });
  });

  it("keeps a pre-filter baseline whose raw visits are gone, marked as counting all channels", async () => {
    const campaign = (await getTvCampaign(db, SLUG))!;
    const old = {
      ...campaign.baseline!,
      filter: undefined,
      sessions: campaign.baseline!.sessions.map(() => 2),
    };
    await db.update(tvCampaigns).set({ baseline: old }).where(eq(tvCampaigns.slug, SLUG));
    await rollupTvUplift(db, new Date("2031-09-01T10:00:00Z"));
    const kept = (await getTvCampaign(db, SLUG))!.baseline!;
    expect(kept.filter).toBe("all");
    expect(kept.sessions[120]).toBe(2);
  });
});
