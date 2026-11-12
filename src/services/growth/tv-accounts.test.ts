import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { tvCampaigns, tvViewers } from "@/db/schema";
import { parseGo3Viewer } from "@/domain/growth/tv";
import { createTvCampaign, recordTvImpression, tvPixelReport } from "./tv";

// Households by Go3 subscription: the viewer id is "<customer>-<profile>-<M|C>", and the
// customer part, hashed per campaign, is the household (docs/TV_PIXEL_BEST_PRACTICE.md §6).

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;
const SLUG = "accttest-go3";
const AT = new Date("2032-04-10T18:00:00Z");
const DAY = "2032-04-10";

describe("Go3 viewer id", () => {
  it("splits into the subscription and the profile type, and refuses other shapes", () => {
    expect(parseGo3Viewer("3205728-344371-M")).toEqual({ account: "3205728", child: false });
    expect(parseGo3Viewer("3205728-9-C")).toEqual({ account: "3205728", child: true });
    for (const other of [
      null,
      "",
      "3205728-344371",
      "3205728-344371-X",
      "1b3e4567-e89b-12d3-a456-426614174000",
    ])
      expect(parseGo3Viewer(other)).toBeNull();
  });
});

run("TV households by subscription", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  const wipe = () => db.delete(tvCampaigns).where(sql`${tvCampaigns.slug} = ${SLUG}`);
  const imp = (vid: string) =>
    recordTvImpression(db, { slug: SLUG, vid, ip: null, userAgent: "tv", now: AT });

  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    await wipe();
    await createTvCampaign(db, { name: "Unit accounts", slug: SLUG });
    // Household 100: the main profile twice and a child's once. Household 200: one main profile.
    await imp("100-1-M");
    await imp("100-1-M");
    await imp("100-2-C");
    await imp("200-7-M");
    // Another platform's device id: a viewer, but no household.
    await imp("tifa-abc-123");
  });
  afterAll(async () => {
    await wipe();
    await end();
  });

  it("stores a hash of the subscription, never the number", async () => {
    const rows = await db
      .select()
      .from(tvViewers)
      .where(sql`${tvViewers.slug} = ${SLUG}`);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.accountHash)).size).toBe(3); // two households and null
    expect(JSON.stringify(rows)).not.toMatch(/\b(100|200)-/);
    expect(rows.filter((r) => r.child)).toHaveLength(1);
  });

  it("reports households, profiles, child impressions and frequency per household", async () => {
    const report = await tvPixelReport(db, SLUG, { from: DAY, to: DAY });
    expect(report.accounts).toEqual({
      households: 2,
      profiles: 3,
      impressions: 4,
      childProfiles: 1,
      childImpressions: 1,
      frequency: [
        { band: "1", households: 1 },
        { band: "2", households: 0 },
        { band: "3-4", households: 1 },
        { band: "5+", households: 0 },
      ],
    });
    expect((await tvPixelReport(db, SLUG, { from: "2032-04-11", to: "2032-04-12" })).accounts).toBeNull();
  });
});
