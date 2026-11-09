import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import {
  affiliateClicks,
  offers,
  tvCampaigns,
  tvExposures,
  tvHouseholdVisits,
  tvPixelAddresses,
  tvViewers,
  visits,
} from "@/db/schema";
import { pixelParams, type DIAGNOSTIC_HEADERS } from "@/domain/growth/tv-pixel";
import { rigaDay } from "@/domain/analytics/visits";
import { recordVisit } from "@/services/visits/visits";
import {
  computeHouseholdDay,
  createTvCampaign,
  getTvCampaign,
  householdSummary,
  purgeTvHouseholds,
  recordTvImpression,
  resetActiveTvCampaigns,
  tvPixelReport,
} from "./tv";

// The pixel's diagnostic, the holdout and the household view-through against the
// database (docs/TV_PIXEL_BEST_PRACTICE.md). Far-future days keep it apart from real data.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
// Not "unit-…": tv.test.ts wipes every campaign with that prefix while this file runs.
const SLUG = "pixeltest-go3";
const T0 = new Date("2032-03-10T18:00:00Z");
const DAY = rigaDay(T0);
const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";

type Headers = Partial<Record<(typeof DIAGNOSTIC_HEADERS)[number], string | null>>;

run("TV pixel", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  const wipe = async () => {
    await db.delete(tvCampaigns).where(sql`${tvCampaigns.slug} = ${SLUG}`);
    await db.delete(visits).where(sql`${visits.day} = ${DAY}`);
    await db.execute(sql`delete from visit_daily where day = ${DAY}::date`);
    await db.delete(affiliateClicks).where(sql`${affiliateClicks.clickedAt} >= '2032-03-09'`);
  };
  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    await wipe();
    await createTvCampaign(db, { name: "Unit pixel", slug: SLUG });
    resetActiveTvCampaigns();
  });
  afterAll(async () => {
    await wipe();
    await end();
  });

  const hit = (query: string, headers: Headers, at: Date, vid = "dev") =>
    recordTvImpression(db, {
      slug: SLUG,
      vid,
      ip: headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? null,
      userAgent: "okhttp/4.9.3",
      now: at,
      pixel: { params: pixelParams(new URLSearchParams(query)), headers },
    });
  const min = (m: number) => new Date(T0.getTime() + m * 60_000);

  it("counts what the requests carried, never the addresses, and reads an ad server's few addresses as such", async () => {
    // Go3's ad server, one address, no household: the usual state today.
    for (let i = 0; i < 3; i++)
      await hit("cr=Spots20&ch=TV3", { "x-forwarded-for": "5.5.5.5" }, min(i), `d${i}`);
    const r = await tvPixelReport(db, SLUG, { from: DAY, to: DAY });
    const d = r.days[0]!;
    expect(d.total).toBe(3);
    expect(d.hops).toEqual([0, 3, 0, 0]);
    expect(d.headers["x-forwarded-for"]).toBe(3);
    expect(d.distinct.xff0).toBe(1);
    expect(d.household.source).toBeNull();
    expect(r.dims.cr).toEqual([{ value: "Spots20", hits: 3 }]);
    expect(r.dims.ua[0]!.value).toBe("server: okhttp");
    const stored = await db
      .select()
      .from(tvPixelAddresses)
      .where(sql`${tvPixelAddresses.slug} = ${SLUG}`);
    expect(JSON.stringify(stored)).not.toContain("5.5.5.5");
    // Frequency: three devices once each.
    expect(r.frequency.find((f) => f.band === "1")!.devices).toBe(3);
  });

  it("keeps holdout calls apart from impressions, and matches households that came to the site", async () => {
    // Household A (ad) and B (ad) by the ?ip= macro; C is in the holdout.
    await hit("ip=81.198.1.1", { "x-forwarded-for": "5.5.5.5" }, min(10), "a");
    await hit("ip=81.198.2.2", { "x-forwarded-for": "5.5.5.5" }, min(10), "b");
    await hit("ip=81.198.3.3&grp=control", { "x-forwarded-for": "5.5.5.5" }, min(10), "c");
    // A person in household A opens the site 6 minutes later; C a day later.
    await recordVisit(db, { path: "/", ip: "81.198.1.1", userAgent: PHONE, now: min(16) });
    await recordVisit(db, { path: "/", ip: "81.198.3.3", userAgent: PHONE, now: min(60 * 24) });
    // A script from household B is left out.
    await recordVisit(db, {
      path: "/",
      ip: "81.198.2.2",
      userAgent: PHONE,
      now: min(12),
      suspect: "no_fetch_meta",
    });
    const exposures = await db
      .select()
      .from(tvExposures)
      .where(sql`${tvExposures.slug} = ${SLUG}`);
    expect(exposures.map((e) => e.grp).sort()).toEqual(["ad", "ad", "control"]);
    expect(JSON.stringify(exposures)).not.toContain("81.198");
    const seen = await db
      .select()
      .from(tvHouseholdVisits)
      .where(sql`${tvHouseholdVisits.slug} = ${SLUG}`);
    expect(seen).toHaveLength(2);
    const campaign = (await getTvCampaign(db, SLUG))!;
    const f = await computeHouseholdDay(db, campaign, DAY);
    expect(f).toEqual({
      source: "macro",
      exposed: 2,
      direct: 1,
      week: 1,
      control: 1,
      controlDirect: 0,
      controlWeek: 1,
    });
    expect(householdSummary([f!]).exposed).toBe(2);
    // The holdout call is not an impression.
    const r = await tvPixelReport(db, SLUG, { from: DAY, to: DAY });
    expect(r.days[0]!.control).toBe(1);
    expect(r.days[0]!.household.reason).toBe("macro");
  });

  it("counts an opted-out device but never follows it: no viewer, address or household hash", async () => {
    const before = await db
      .select()
      .from(tvExposures)
      .where(sql`${tvExposures.slug} = ${SLUG}`);
    const viewersBefore = await db
      .select()
      .from(tvViewers)
      .where(sql`${tvViewers.slug} = ${SLUG}`);
    await hit("ip=81.198.7.7&lat=1&co=LV", { "x-forwarded-for": "5.5.5.5" }, min(30), "optout-device");
    expect(
      await db
        .select()
        .from(tvExposures)
        .where(sql`${tvExposures.slug} = ${SLUG}`),
    ).toHaveLength(before.length);
    expect(
      await db
        .select()
        .from(tvViewers)
        .where(sql`${tvViewers.slug} = ${SLUG}`),
    ).toHaveLength(viewersBefore.length);
    const r = await tvPixelReport(db, SLUG, { from: DAY, to: DAY });
    expect(r.days[0]!.optOut).toBe(1);
    expect(r.dims.co).toEqual([{ value: "LV", hits: 1 }]);
  });

  it("forgets household rows after 21 days", async () => {
    expect(await purgeTvHouseholds(db, new Date(T0.getTime() + 30 * 86_400_000))).toBeGreaterThan(0);
    expect(
      await db
        .select()
        .from(tvExposures)
        .where(sql`${tvExposures.slug} = ${SLUG}`),
    ).toHaveLength(0);
  });

  it("leaves a visitor's day out of the visit figures once one of their clicks was a script", async () => {
    const [offer] = await db.select({ id: offers.id }).from(offers).limit(1);
    if (!offer) return;
    const { visitRows, recordShopClick } = await import("@/services/visits/visits");
    const day = rigaDay(min(0));
    const at = min(120);
    await recordVisit(db, { path: "/unit-left-out", ip: "198.51.100.90", userAgent: PHONE, now: at });
    await recordVisit(db, { path: "/unit-left-out", ip: "198.51.100.91", userAgent: PHONE, now: at });
    await recordShopClick(db, {
      offerId: offer.id,
      ip: "198.51.100.91",
      userAgent: PHONE,
      searchSessionId: null,
      adLandingId: null,
      source: "ask",
      signals: { site: null, mode: null, user: null, referrerHost: null, lang: null },
      now: at,
    });
    // Read live (the day as "today"): a rollup with a far-future clock would purge other tests' raw visits.
    const rows = (await visitRows(db, day, day, at)).filter((r) => r.path === "/unit-left-out");
    expect(rows.map((r) => r.visitors)).toEqual([1]);
  });
});
