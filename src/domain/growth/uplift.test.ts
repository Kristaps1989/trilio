import { describe, expect, it } from "vitest";
import {
  afterTv,
  baselineProfile,
  exposure,
  BUCKETS,
  bucketLabel,
  bucketOf,
  correlation,
  dayUplift,
  perBucket,
  rigaDayStart,
  rigaMinutes,
  sessionsOf,
  summarise,
  type Session,
} from "./uplift";

// The TV uplift arithmetic (docs/TV_ANALYTICS_PLAN.md §1) on synthetic days.

/** 2031-03-03 (winter time, UTC+2) at Riga hh:mm. */
const riga = (hh: number, mm: number) => new Date(Date.UTC(2031, 2, 3, hh - 2, mm));

describe("buckets", () => {
  it("places a moment in its Riga 10-minute bucket", () => {
    expect(rigaMinutes(riga(0, 0))).toBe(0);
    expect(rigaMinutes(riga(20, 35))).toBe(20 * 60 + 35);
    expect(bucketOf(riga(0, 9))).toBe(0);
    expect(bucketOf(riga(0, 10))).toBe(1);
    expect(bucketOf(riga(20, 35))).toBe(123);
    expect(bucketOf(riga(23, 59))).toBe(BUCKETS - 1);
    expect(bucketLabel(123)).toBe("20:30");
    // Summer time: 2031-07-03 21:00 Riga is 18:00 UTC.
    expect(bucketOf(new Date(Date.UTC(2031, 6, 3, 18, 0)))).toBe(126);
  });
  it("finds the start of a Riga day in winter and summer time", () => {
    expect(rigaDayStart("2031-03-03").toISOString()).toBe("2031-03-02T22:00:00.000Z");
    expect(rigaDayStart("2031-07-03").toISOString()).toBe("2031-07-02T21:00:00.000Z");
    expect(bucketOf(rigaDayStart("2031-07-03"))).toBe(0);
  });
  it("counts items per bucket", () => {
    const pb = perBucket([{ at: riga(20, 35) }, { at: riga(20, 39), n: 3 }, { at: riga(8, 0) }]);
    expect(pb[123]).toBe(4);
    expect(pb[48]).toBe(1);
    expect(pb.reduce((a, b) => a + b, 0)).toBe(5);
  });
});

describe("sessions", () => {
  it("starts a session after 30 minutes of silence, per visitor, and keeps results and phone", () => {
    const sessions = sessionsOf([
      { visitorHash: "a", at: riga(20, 0), section: "flow", client: "Chrome Android" },
      { visitorHash: "a", at: riga(20, 20), section: "results", client: "Chrome Android" },
      { visitorHash: "a", at: riga(21, 10), section: "home", client: "Chrome Android" },
      { visitorHash: "b", at: riga(20, 5), section: "home", client: "Safari macOS" },
    ]);
    expect(sessions.map((s) => [s.visitorHash, s.bucket, s.results, s.phone])).toEqual([
      ["a", 120, true, true],
      ["b", 120, false, false],
      ["a", 127, false, true],
    ]);
  });
  it("is empty without views", () => {
    expect(sessionsOf([])).toEqual([]);
  });
});

describe("baseline and after-TV windows", () => {
  it("averages days per bucket", () => {
    const a = new Array(BUCKETS).fill(0);
    const b = new Array(BUCKETS).fill(0);
    a[120] = 4;
    b[120] = 2;
    b[121] = 1;
    const base = baselineProfile([a, b]);
    expect(base[120]).toBe(3);
    expect(base[121]).toBe(0.5);
    expect(baselineProfile([])).toEqual(new Array(BUCKETS).fill(0));
  });
  it("spreads exposure over the impression bucket and the next one", () => {
    const imp = new Array(BUCKETS).fill(0);
    imp[120] = 5;
    imp[121] = 2;
    const x = exposure(imp);
    expect([x[119], x[120], x[121], x[122], x[123]]).toEqual([0, 5, 7, 2, 0]);
  });
  it("marks the impression bucket and the next one", () => {
    const imp = new Array(BUCKETS).fill(0);
    imp[120] = 5;
    imp[143] = 1;
    const after = afterTv(imp);
    expect(after.filter(Boolean).length).toBe(3);
    expect([after[119], after[120], after[121], after[122], after[143]]).toEqual([
      false,
      true,
      true,
      false,
      true,
    ]);
  });
});

describe("correlation", () => {
  it("is 1 for a proportional series, −1 for an inverse one, null without variance", () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(correlation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(correlation([1], [1])).toBeNull();
  });
});

describe("a day's uplift", () => {
  const session = (hh: number, mm: number, extra: Partial<Session> = {}): Session => ({
    visitorHash: `${hh}${mm}`,
    at: riga(hh, mm),
    bucket: bucketOf(riga(hh, mm)),
    results: false,
    phone: false,
    ...extra,
  });
  it("counts sessions, results, clicks and phones in the after-TV buckets against the baseline", () => {
    const impressions = new Array(BUCKETS).fill(0);
    impressions[120] = 40; // 20:00–20:09
    const baseline = new Array(BUCKETS).fill(1); // one session per bucket before the campaign
    const d = dayUplift({
      impressions,
      sessions: [
        session(20, 3, { phone: true, results: true }),
        session(20, 12),
        session(20, 15, { phone: true }),
        session(9, 0), // outside the window
      ],
      clicks: [riga(20, 14), riga(10, 0)],
      baseline,
    });
    expect(d.impressions).toBe(40);
    expect(d.tvBuckets).toBe(2);
    expect(d.sessionsDay).toBe(4);
    expect(d.sessionsAfter).toBe(3);
    expect(d.expectedAfter).toBe(2);
    expect(d.uplift).toBe(1);
    expect(d.resultsAfter).toBe(1);
    expect(d.clicksAfter).toBe(1);
    expect(d.phoneAfter).toBe(2);
    expect(d.correlation).toBeGreaterThan(0.5);
    expect(d.buckets[120]).toEqual([40, 1]);
    expect(d.buckets[121]).toEqual([0, 2]);
    expect(d.buckets).toHaveLength(BUCKETS);
  });
  it("never reports a negative uplift, and no uplift without a baseline", () => {
    const impressions = new Array(BUCKETS).fill(0);
    impressions[60] = 10;
    const quiet = dayUplift({
      impressions,
      sessions: [],
      clicks: [],
      baseline: new Array(BUCKETS).fill(2),
    });
    expect(quiet.sessionsAfter).toBe(0);
    expect(quiet.expectedAfter).toBe(4);
    expect(quiet.uplift).toBe(0);
    const noBase = dayUplift({ impressions, sessions: [session(10, 2)], clicks: [], baseline: null });
    expect(noBase.sessionsAfter).toBe(1);
    expect(noBase.expectedAfter).toBeNull();
    expect(noBase.uplift).toBeNull();
    const noTv = dayUplift({
      impressions: new Array(BUCKETS).fill(0),
      sessions: [session(10, 2)],
      clicks: [],
      baseline: null,
    });
    expect(noTv.tvBuckets).toBe(0);
    expect(noTv.correlation).toBeNull();
  });
});

describe("the campaign summary", () => {
  it("sums the days, gives the uplift in percent and the correlation over all buckets", () => {
    const impressions = new Array(BUCKETS).fill(0);
    impressions[120] = 50;
    const baseline = new Array(BUCKETS).fill(1);
    const sessions = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        visitorHash: `v${i}`,
        at: riga(20, i % 10),
        bucket: 120,
        results: i === 0,
        phone: i % 2 === 0,
      }));
    const day1 = dayUplift({ impressions, sessions: sessions(5), clicks: [riga(20, 5)], baseline });
    const day2 = dayUplift({ impressions, sessions: sessions(3), clicks: [], baseline });
    const s = summarise([day1, day2], baseline);
    expect(s.days).toBe(2);
    expect(s.impressions).toBe(100);
    expect(s.sessionsAfter).toBe(8);
    expect(s.expectedAfter).toBe(4);
    expect(s.uplift).toBe(4);
    expect(s.upliftPct).toBe(100);
    expect(s.resultsAfter).toBe(2);
    expect(s.clicksAfter).toBe(1);
    expect(s.phoneAfter).toBe(5);
    expect(s.correlation).toBeGreaterThan(0.5);
    expect(s.profile.impressions[120]).toBe(100);
    expect(s.profile.sessions[120]).toBe(8);
    expect(s.profile.baseline[120]).toBe(2);
  });
  it("is empty for no days", () => {
    const s = summarise([], null);
    expect(s.days).toBe(0);
    expect(s.uplift).toBeNull();
    expect(s.upliftPct).toBeNull();
    expect(s.correlation).toBeNull();
  });
});
