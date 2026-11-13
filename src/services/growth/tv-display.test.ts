import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { tvCampaigns, tvExposures, tvHouseholdVisits, tvViewers, visits } from "@/db/schema";
import { adParams } from "@/domain/growth/attribution";
import { landingChannel, TV_ELIGIBLE } from "@/domain/growth/channels";
import { advertisingId, displayPixelUrl, landingWithTags } from "@/domain/growth/tv";
import { pixelParams } from "@/domain/growth/tv-pixel";
import {
  createTvCampaign,
  deleteTvCampaign,
  flightOverlap,
  getTvCampaign,
  linkFlight,
  recordHouseholdVisit,
  recordTvImpression,
  resetActiveTvCampaigns,
  tvStats,
  unlinkFlight,
} from "./tv";

// Display campaigns (a banner on a publisher's site, trafficked in Google Ad Manager) and a
// TV + display flight whose households can be compared (docs/DISPLAY_PLAN.md).

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const TV = "flighttest-tv";
const BANNER = "flighttest-banner";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const T0 = new Date("2032-06-10T18:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

describe("display campaign addresses", () => {
  it("tags the click as display from the publisher, which is its own channel and not TV's", () => {
    const path = landingWithTags("/izvelies", "banner-1", { kind: "display", source: "tv3.lv" });
    expect(path).toBe("/izvelies?utm_source=tv3.lv&utm_medium=display&utm_campaign=banner-1");
    const tags = adParams(Object.fromEntries(new URLSearchParams(path.split("?")[1])))!;
    expect(landingChannel(tags)).toBe("display");
    expect(TV_ELIGIBLE.has("display")).toBe(false);
    // A TV campaign's link is unchanged.
    expect(landingWithTags("/izvelies", "go3-1")).toBe(
      "/izvelies?utm_source=go3&utm_medium=tv&utm_campaign=go3-1",
    );
  });

  it("gives Ad Manager a tracker whose unfilled macros are never stored as values", () => {
    const u = new URL(displayPixelUrl("https://trilio.lv", "banner-1"));
    expect(u.pathname).toBe("/px/banner-1");
    const p = pixelParams(u.searchParams);
    expect([p.cr, p.placement, p.ch, p.pos, p.vid, p.idType]).toEqual([null, null, null, null, null, null]);
    expect([p.optOut, p.preview]).toEqual([false, false]);
    // On the web the app-only macros come empty; in an app they carry the advertising id.
    const web = pixelParams(
      new URLSearchParams(
        "cr=138412345&pl=/123/tv3/news&ch=tv3.lv&pos=300x250&vid=&idt=&lat=&tfua=0&pv=false",
      ),
    );
    expect([web.cr, web.placement, web.ch, web.pos, web.vid]).toEqual([
      "138412345",
      "/123/tv3/news",
      "tv3.lv",
      "300x250",
      null,
    ]);
    const app = pixelParams(new URLSearchParams("vid=38400000-8cf0-11bd-b23e-10b96e40000d&idt=adid&lat=0"));
    expect([app.vid, app.idType, app.optOut]).toEqual([
      "38400000-8cf0-11bd-b23e-10b96e40000d",
      "adid",
      false,
    ]);
    // Limit ad tracking and a user under the age of consent: counted, never followed.
    expect(pixelParams(new URLSearchParams("lat=1")).optOut).toBe(true);
    expect(pixelParams(new URLSearchParams("tfua=1")).optOut).toBe(true);
    expect(pixelParams(new URLSearchParams("pv=true")).preview).toBe(true);
  });
});

run("display campaigns and flights", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  const wipe = async () => {
    await db.delete(tvCampaigns).where(sql`${tvCampaigns.slug} like 'flighttest-%'`);
    await db.delete(visits).where(sql`${visits.visitorHash} like 'unit-flight-%'`);
    resetActiveTvCampaigns();
  };
  // The TV spot: Go3's ad server calls, the household's address comes in the macro.
  const tv = (ip: string, now: Date) =>
    recordTvImpression(db, {
      slug: TV,
      vid: null,
      ip: "203.0.113.200",
      userAgent: "FreeWheel",
      now,
      pixel: { params: pixelParams(new URLSearchParams({ ip })), headers: {} },
    });
  // The banner: the visitor's own browser calls.
  const banner = (ip: string, now: Date, userAgent = CHROME) =>
    recordTvImpression(db, {
      slug: BANNER,
      vid: null,
      ip,
      userAgent,
      now,
      pixel: { params: pixelParams(new URLSearchParams("ch=tv3.lv")), headers: {} },
    });

  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    await wipe();
    await createTvCampaign(db, { name: "Unit TV", slug: TV });
    expect(
      await createTvCampaign(db, { name: "Unit banner", slug: BANNER, kind: "display", source: "tv3.lv" }),
    ).toEqual({ ok: true, slug: BANNER });
  });
  afterAll(async () => {
    await wipe();
    await end();
  });

  it("refuses a publisher name that is not a host or a short word", async () => {
    expect(
      await createTvCampaign(db, { name: "x", slug: "flighttest-bad", kind: "display", source: "tv3 lv!" }),
    ).toEqual({ ok: false, error: "source" });
  });

  it("counts a banner's people, not crawlers, with the browser's address as the household", async () => {
    await banner("198.51.100.7", at(0));
    await banner(
      "198.51.100.7",
      at(1),
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    );
    const stats = (await tvStats(db, { from: "2032-06-10", to: "2032-06-11" })).find(
      (c) => c.campaign.slug === BANNER,
    )!;
    expect(stats.impressions).toBe(1);
    expect(stats.reach).toBe(1);
    const rows = await db
      .select()
      .from(tvExposures)
      .where(sql`${tvExposures.slug} = ${BANNER}`);
    expect(rows.map((r) => r.source)).toEqual(["client"]);
    expect(JSON.stringify(rows)).not.toContain("198.51.100.7");
  });

  it("cannot compare households before the campaigns are linked", async () => {
    expect(await flightOverlap(db, TV)).toBeNull();
    expect(await linkFlight(db, TV, TV)).toEqual({ ok: false, error: "flight_same" });
  });

  it("links a flight, then sees which households saw TV, the banner or both, and who came", async () => {
    expect(await linkFlight(db, TV, BANNER, at(5))).toEqual({ ok: true });
    expect(await linkFlight(db, TV, BANNER, at(5))).toEqual({ ok: false, error: "flight_taken" });
    const [a, b] = await Promise.all([getTvCampaign(db, TV), getTvCampaign(db, BANNER)]);
    expect(a!.flightSalt).toBe(b!.flightSalt);
    expect(a!.flightSalt).not.toBe(a!.salt);
    // Household .11 sees both, .12 only TV, .13 only the banner; .7 saw the banner before the link.
    await tv("198.51.100.11", at(10));
    await banner("198.51.100.11", at(20));
    await tv("198.51.100.12", at(11));
    await banner("198.51.100.13", at(21));
    // People from .11 and .13 open Trilio afterwards; .12 came before its exposure only.
    resetActiveTvCampaigns();
    const visit = (ip: string, now: Date, visitor: string) =>
      recordHouseholdVisit(db, { ip, visitorHash: `unit-flight-${visitor}`, day: "2032-06-10", now });
    await visit("198.51.100.11", at(40), "a");
    await visit("198.51.100.13", at(45), "b");
    await visit("198.51.100.12", at(6), "c");
    // An admin's own browsing from a household that saw only TV is not a response (.12 stays at 0).
    await visit("198.51.100.12", at(50), "admin");
    await db.insert(visits).values({
      day: "2032-06-10",
      path: "/admin",
      section: "admin",
      subcategory: null,
      visitorHash: "unit-flight-admin",
      client: "Chrome Windows",
      suspect: "admin",
      createdAt: at(50),
    });
    const o = (await flightOverlap(db, TV))!;
    expect(o.partner).toMatchObject({ slug: BANNER, kind: "display" });
    expect(o.groups).toEqual({
      own: { households: 1, came: 0 },
      partner: { households: 1, came: 1 },
      both: { households: 1, came: 1 },
    });
    // No tracker has carried a device advertising id yet.
    expect(o.devices).toBeNull();
    // The same flight from the banner's side.
    expect((await flightOverlap(db, BANNER))!.groups).toEqual({
      own: { households: 1, came: 1 },
      partner: { households: 1, came: 0 },
      both: { households: 1, came: 1 },
    });
  });

  it("matches the same device exactly when both trackers carry its advertising id", async () => {
    const PHONE = "38400000-8cf0-11bd-b23e-10b96e40000d";
    const OTHER = "11111111-2222-3333-4444-555555555555";
    const call = (slug: string, query: Record<string, string>, ip: string) =>
      recordTvImpression(db, {
        slug,
        vid: query.vid ?? null,
        ip,
        userAgent: CHROME,
        now: at(60),
        pixel: { params: pixelParams(new URLSearchParams(query)), headers: {} },
      });
    // Go3 sends the id in did (with its type); Ad Manager, in an app, in vid.
    await call(
      TV,
      { vid: "3205728-344371-M", did: `aaid:${PHONE.toUpperCase()}`, ip: "198.51.100.30" },
      "203.0.113.200",
    );
    await call(BANNER, { vid: PHONE }, "198.51.100.31");
    await call(BANNER, { vid: OTHER }, "198.51.100.32");
    // Limited ad tracking: counted, but no device hash.
    await call(BANNER, { vid: "99999999-2222-3333-4444-555555555555", lat: "1" }, "198.51.100.33");
    expect((await flightOverlap(db, TV))!.devices).toEqual({ own: 0, partner: 1, both: 1 });
    const rows = await db
      .select()
      .from(tvViewers)
      .where(sql`${tvViewers.slug} like 'flighttest-%'`);
    expect(JSON.stringify(rows)).not.toContain(PHONE);
    expect(advertisingId("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(advertisingId("3205728-344371-M")).toBeNull();
  });

  it("ends the flight when asked, or when one of its campaigns is deleted", async () => {
    await unlinkFlight(db, BANNER);
    expect((await getTvCampaign(db, TV))!.flightSalt).toBeNull();
    // The device hashes go with the shared salt.
    const kept = await db
      .select()
      .from(tvViewers)
      .where(sql`${tvViewers.slug} like 'flighttest-%'`);
    expect(kept.every((r) => r.deviceHash === null)).toBe(true);
    expect(await flightOverlap(db, TV)).toBeNull();
    expect(await linkFlight(db, BANNER, TV)).toEqual({ ok: true });
    await deleteTvCampaign(db, BANNER);
    const left = (await getTvCampaign(db, TV))!;
    expect([left.flightSalt, left.flightWith]).toEqual([null, null]);
    expect(
      (
        await db
          .select()
          .from(tvHouseholdVisits)
          .where(sql`${tvHouseholdVisits.slug} = ${BANNER}`)
      ).length,
    ).toBe(0);
  });
});
