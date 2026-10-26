import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { adLandings, affiliateClicks, offers, tvCampaigns, tvViewers } from "@/db/schema";
import {
  createTvCampaign,
  deleteTvCampaign,
  purgeTvViewers,
  recordTvImpression,
  recordTvLinkOpen,
  tvStats,
} from "./tv";

// Addressable TV measurement against the database (docs/GROWTH_PLAN.md, TV).

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const SLUG = "unit-go3-test";

run("TV campaigns", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  const wipe = async () => {
    await db.delete(adLandings).where(sql`${adLandings.utmCampaign} = ${SLUG}`);
    await db.delete(tvCampaigns).where(sql`${tvCampaigns.slug} like 'unit-%'`);
  };
  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    await wipe();
  });
  afterAll(async () => {
    await wipe();
    await end();
  });

  it("creates a campaign with a valid slug and landing page, once", async () => {
    expect(
      await createTvCampaign(db, { name: "Unit Go3 test", slug: SLUG, landingPath: "/izvelies" }),
    ).toEqual({
      ok: true,
      slug: SLUG,
    });
    expect(await createTvCampaign(db, { name: "x", slug: SLUG })).toEqual({ ok: false, error: "taken" });
    expect(await createTvCampaign(db, { name: "x", slug: "Ā!" })).toEqual({ ok: false, error: "slug" });
    expect(await createTvCampaign(db, { name: "unit x", landingPath: "https://evil.example" })).toEqual({
      ok: false,
      error: "landing",
    });
    expect(await createTvCampaign(db, { name: "unit x", landingPath: "//evil.example" })).toEqual({
      ok: false,
      error: "landing",
    });
  });

  it("counts impressions and unique devices, never storing the id", async () => {
    const now = new Date("2031-05-05T10:00:00Z");
    const hit = (vid: string | null, ip: string | null = null) =>
      recordTvImpression(db, { slug: SLUG, vid, ip, userAgent: "FreeWheel SSAI", now });
    expect(await hit("device-1")).toBe(true);
    expect(await hit("device-1")).toBe(true);
    expect(await hit("device-2")).toBe(true);
    // The macro left unfilled: reach falls back to the forwarded address.
    expect(await hit('#{request.keyValue("_fw_vcid2")}', "203.0.113.5")).toBe(true);
    // Neither id nor address: an impression without reach.
    expect(await hit(null)).toBe(true);
    expect(
      await recordTvImpression(db, { slug: "unit-unknown", vid: "x", ip: null, userAgent: null, now }),
    ).toBe(false);
    await recordTvLinkOpen(db, SLUG, now);
    const rows = await db
      .select()
      .from(tvViewers)
      .where(sql`${tvViewers.slug} = ${SLUG}`);
    expect(JSON.stringify(rows)).not.toContain("device-1");
    expect(JSON.stringify(rows)).not.toContain("203.0.113.5");

    const [offer] = await db.select({ id: offers.id }).from(offers).limit(1);
    const [landing] = await db
      .insert(adLandings)
      .values({
        day: "2031-05-05",
        visitorHash: "unit",
        path: "/izvelies",
        utmSource: "go3",
        utmMedium: "tv",
        utmCampaign: SLUG,
      })
      .returning();
    await db.insert(affiliateClicks).values({ offerId: offer!.id, adLandingId: landing!.id });

    const s = (await tvStats(db)).find((c) => c.campaign.slug === SLUG)!;
    expect(s).toMatchObject({ impressions: 5, reach: 3, linkOpens: 1, visits: 1, shopClicks: 1 });
    expect(s.days).toEqual([{ day: "2031-05-05", impressions: 5, reach: 3, linkOpens: 1 }]);
    await db.delete(affiliateClicks).where(sql`${affiliateClicks.adLandingId} = ${landing!.id}`);
  });

  it("forgets devices after 90 days and deletes everything with the campaign", async () => {
    expect(await purgeTvViewers(db, new Date("2031-08-10T10:00:00Z"))).toBe(3);
    const s = (await tvStats(db)).find((c) => c.campaign.slug === SLUG)!;
    expect(s).toMatchObject({ impressions: 5, reach: 0 });
    await deleteTvCampaign(db, SLUG);
    expect((await tvStats(db)).find((c) => c.campaign.slug === SLUG)).toBeUndefined();
  });
});
