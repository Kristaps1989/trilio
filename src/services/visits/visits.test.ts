import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { affiliateClicks, botHits, offers, visits } from "@/db/schema";
import { rigaDay } from "@/domain/analytics/visits";
import { botStats, clientStats, countBot, recordShopClick, recordVisit } from "./visits";

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
