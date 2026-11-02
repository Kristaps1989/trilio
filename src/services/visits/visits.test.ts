import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { adLandings, affiliateClicks, botHits, offers, visits } from "@/db/schema";
import { rigaDay } from "@/domain/analytics/visits";
import { botStats, clientStats, countBot, recordShopClick, recordVisit } from "./visits";
import { clickSourceStats, shopStats } from "@/services/admin/stats";

// Bot filtering and de-duplication in Trilio's own statistics.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

const PHONE =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const FAR_DAY = new Date("2031-03-03T10:00:00Z");

run("statistics without bots", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  let offerId: string;
  const day = rigaDay(FAR_DAY);
  const wipe = async () => {
    await db.delete(botHits).where(sql`${botHits.day} = ${day}`);
    await db.delete(visits).where(sql`${visits.day} = ${day}`);
    await db
      .delete(affiliateClicks)
      .where(sql`${affiliateClicks.clickedAt} >= ${FAR_DAY.toISOString()}::timestamptz - interval '2 hours'`);
  };
  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    const [o] = await db.select({ id: offers.id }).from(offers).limit(1);
    offerId = o!.id;
    await wipe();
  });
  afterAll(async () => {
    await wipe();
    await end();
  });

  it("counts a visitor's repeat click on the same product within 30 minutes once", async () => {
    const who = { offerId, ip: "198.51.100.7", userAgent: PHONE, searchSessionId: null, adLandingId: null };
    expect(await recordShopClick(db, { ...who, now: FAR_DAY })).toBe(true);
    expect(await recordShopClick(db, { ...who, now: new Date(FAR_DAY.getTime() + 10 * 60_000) })).toBe(false);
    expect(
      await recordShopClick(db, { ...who, ip: "198.51.100.8", now: new Date(FAR_DAY.getTime() + 60_000) }),
    ).toBe(true);
    expect(await recordShopClick(db, { ...who, now: new Date(FAR_DAY.getTime() + 31 * 60_000) })).toBe(true);
  });

  it("records each click's link, and leaves an admin's own clicks out of the statistics", async () => {
    const t0 = new Date(FAR_DAY.getTime() + 3 * 3600_000);
    const who = { offerId, userAgent: PHONE, searchSessionId: null, adLandingId: null };
    const day = t0.toLocaleDateString("en-CA", { timeZone: "Europe/Riga" });
    const total = async () => (await shopStats(db, day, day)).reduce((n, r) => n + r.clicks, 0);
    const before = await total();
    await recordShopClick(db, { ...who, ip: "198.51.100.21", source: "ask", now: t0 });
    await recordShopClick(db, { ...who, ip: "198.51.100.22", source: "newtab", now: t0 });
    await recordShopClick(db, { ...who, ip: "198.51.100.23", source: "card", internal: true, now: t0 });
    const s = await clickSourceStats(db, day, day);
    expect(s.sources.find((x) => x.source === "ask")?.clicks).toBe(1);
    expect(s.sources.find((x) => x.source === "newtab")?.clicks).toBe(1);
    expect(s.sources.find((x) => x.source === "card")).toBeUndefined();
    expect(s.internal).toBe(1);
    expect((await total()) - before).toBe(2);
  });

  it("credits an ad visit recorded after the first click to that click, without counting twice", async () => {
    const [landing] = await db
      .insert(adLandings)
      .values({ day, visitorHash: "e2e-test", path: "/e2e-bots", gclid: "e2e-bots" })
      .returning();
    const who = { offerId, ip: "198.51.100.9", userAgent: PHONE, searchSessionId: null };
    const t0 = new Date(FAR_DAY.getTime() + 40 * 60_000);
    expect(await recordShopClick(db, { ...who, adLandingId: null, now: t0 })).toBe(true);
    expect(
      await recordShopClick(db, { ...who, adLandingId: landing!.id, now: new Date(t0.getTime() + 60_000) }),
    ).toBe(false);
    const rows = await db
      .select()
      .from(affiliateClicks)
      .where(sql`${affiliateClicks.adLandingId} = ${landing!.id}`);
    expect(rows).toHaveLength(1);
    await db.delete(affiliateClicks).where(sql`${affiliateClicks.adLandingId} = ${landing!.id}`);
    await db.delete(adLandings).where(sql`${adLandings.id} = ${landing!.id}`);
  });

  it("counts bots apart, per kind and day", async () => {
    await countBot(db, "click", FAR_DAY);
    await countBot(db, "click", FAR_DAY);
    await countBot(db, "visit", FAR_DAY);
    expect(await botStats(db, day, day)).toEqual({ visit: 1, search: 0, click: 2 });
  });

  it("stores the browser family of a visit, never the user agent", async () => {
    expect(await recordVisit(db, { path: "/", ip: "198.51.100.7", userAgent: PHONE, now: FAR_DAY })).toBe(
      true,
    );
    expect(
      await recordVisit(db, { path: "/izvelies", ip: "198.51.100.7", userAgent: PHONE, now: FAR_DAY }),
    ).toBe(true);
    const [row] = await db
      .select()
      .from(visits)
      .where(sql`${visits.day} = ${day}`)
      .limit(1);
    expect(row!.client).toBe("Chrome Android");
    expect(JSON.stringify(row)).not.toContain("SM-S911B");
    expect(await clientStats(db, day, day)).toEqual([{ client: "Chrome Android", visitors: 1, views: 2 }]);
  });
});
