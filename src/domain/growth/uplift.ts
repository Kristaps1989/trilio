// The TV uplift (docs/TV_ANALYTICS_PLAN.md §1): what addressable TV adds to
// the site's traffic, from the pixel's impressions per minute and the site's
// own page views. Pure functions over a day in 10-minute buckets; the service
// feeds them rows and stores the result.

/** Buckets per day. */
export const BUCKETS = 144;
export const BUCKET_MINUTES = 10;
/** A page view this long after the visitor's previous one starts a new session. */
export const SESSION_GAP_MS = 30 * 60_000;
/** The baseline is the average of this many days before the first impression. */
export const BASELINE_DAYS = 14;
/** A bucket is "after TV" when impressions fell in it or in the previous one (0–20 minutes). */
const RESPONSE_BUCKETS = 1;

const RIGA = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Riga",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since midnight in Riga. */
export function rigaMinutes(d: Date): number {
  const parts = RIGA.formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** The instant a Riga calendar day ("YYYY-MM-DD") starts. */
export function rigaDayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  // Riga is UTC+2 or UTC+3: start three hours before UTC midnight and walk forward to local 00:00.
  let t = Date.UTC(y, m - 1, d) - 3 * 3_600_000;
  for (let i = 0; i < 240; i++, t += 60_000) {
    const at = new Date(t);
    if (rigaMinutes(at) === 0 && RIGA_DAY.format(at) === day) return at;
  }
  return new Date(Date.UTC(y, m - 1, d) - 2 * 3_600_000);
}

const RIGA_DAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Riga" });

export function bucketOf(d: Date): number {
  return Math.min(BUCKETS - 1, Math.floor(rigaMinutes(d) / BUCKET_MINUTES));
}

/** "HH:MM" for a bucket's start, for the chart's axis. */
export function bucketLabel(b: number): string {
  const m = b * BUCKET_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export type PageView = {
  visitorHash: string;
  at: Date;
  section: string;
  /** Browser family and system, e.g. "Chrome Android". */
  client: string | null;
};

export type Session = {
  visitorHash: string;
  at: Date;
  bucket: number;
  /** Reached a results page in this session. */
  results: boolean;
  /** On a phone or tablet (Android, iOS). */
  phone: boolean;
};

export function isPhone(client: string | null | undefined): boolean {
  return /Android|iOS/.test(client ?? "");
}

/** Sessions from a day's page views: a view after a 30-minute silence starts one. */
export function sessionsOf(views: PageView[]): Session[] {
  const byVisitor = new Map<string, PageView[]>();
  for (const v of views) {
    const list = byVisitor.get(v.visitorHash) ?? [];
    list.push(v);
    byVisitor.set(v.visitorHash, list);
  }
  const out: Session[] = [];
  for (const list of byVisitor.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    let current: Session | null = null;
    let last = -Infinity;
    for (const v of list) {
      if (!current || v.at.getTime() - last > SESSION_GAP_MS) {
        current = {
          visitorHash: v.visitorHash,
          at: v.at,
          bucket: bucketOf(v.at),
          results: false,
          phone: isPhone(v.client),
        };
        out.push(current);
      }
      if (v.section === "results") current.results = true;
      last = v.at.getTime();
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function perBucket(items: { at: Date; n?: number }[]): number[] {
  const out = new Array<number>(BUCKETS).fill(0);
  for (const i of items) out[bucketOf(i.at)]! += i.n ?? 1;
  return out;
}

/** The average sessions per bucket over whole days. */
export function baselineProfile(days: number[][]): number[] {
  const out = new Array<number>(BUCKETS).fill(0);
  if (days.length === 0) return out;
  for (const d of days) for (let b = 0; b < BUCKETS; b++) out[b]! += d[b] ?? 0;
  return out.map((v) => v / days.length);
}

/** Which buckets are after TV: impressions in them or in the previous RESPONSE_BUCKETS. */
export function afterTv(impressions: number[]): boolean[] {
  const out = new Array<boolean>(BUCKETS).fill(false);
  for (let b = 0; b < BUCKETS; b++) {
    if ((impressions[b] ?? 0) <= 0) continue;
    for (let k = 0; k <= RESPONSE_BUCKETS && b + k < BUCKETS; k++) out[b + k] = true;
  }
  return out;
}

/** Exposure per bucket: impressions in it and in the previous RESPONSE_BUCKETS, the same window the uplift uses. */
export function exposure(impressions: number[]): number[] {
  const out = new Array<number>(BUCKETS).fill(0);
  for (let b = 0; b < BUCKETS; b++)
    for (let k = 0; k <= RESPONSE_BUCKETS; k++) if (b - k >= 0) out[b]! += impressions[b - k] ?? 0;
  return out;
}

/** Pearson correlation, or null when either series does not vary. */
export function correlation(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

export type DayUplift = {
  impressions: number;
  tvBuckets: number;
  sessionsDay: number;
  sessionsAfter: number;
  expectedAfter: number | null;
  uplift: number | null;
  resultsAfter: number;
  clicksAfter: number;
  phoneAfter: number;
  correlation: number | null;
  /** [impressions, sessions] per bucket. */
  buckets: [number, number][];
};

/** One day's figures (docs/TV_ANALYTICS_PLAN.md §1). */
export function dayUplift(input: {
  impressions: number[];
  sessions: Session[];
  clicks: Date[];
  baseline: number[] | null;
}): DayUplift {
  const after = afterTv(input.impressions);
  const sessionsPerBucket = perBucket(input.sessions);
  const clicksPerBucket = perBucket(input.clicks.map((at) => ({ at })));
  let tvBuckets = 0;
  let sessionsAfter = 0;
  let expected = 0;
  let clicksAfter = 0;
  for (let b = 0; b < BUCKETS; b++) {
    if (!after[b]) continue;
    tvBuckets++;
    sessionsAfter += sessionsPerBucket[b]!;
    expected += input.baseline?.[b] ?? 0;
    clicksAfter += clicksPerBucket[b]!;
  }
  let resultsAfter = 0;
  let phoneAfter = 0;
  for (const s of input.sessions) {
    if (!after[s.bucket]) continue;
    if (s.results) resultsAfter++;
    if (s.phone) phoneAfter++;
  }
  const hasBaseline = !!input.baseline;
  const diff = sessionsPerBucket.map((v, b) => v - (input.baseline?.[b] ?? 0));
  return {
    impressions: input.impressions.reduce((a, b) => a + b, 0),
    tvBuckets,
    sessionsDay: input.sessions.length,
    sessionsAfter,
    expectedAfter: hasBaseline ? round2(expected) : null,
    uplift: hasBaseline ? round2(Math.max(0, sessionsAfter - expected)) : null,
    resultsAfter,
    clicksAfter,
    phoneAfter,
    correlation: tvBuckets > 0 ? roundOrNull(correlation(exposure(input.impressions), diff), 3) : null,
    buckets: input.impressions.map((imp, b) => [imp, sessionsPerBucket[b]!]),
  };
}

export type UpliftSummary = {
  days: number;
  impressions: number;
  sessionsAfter: number;
  expectedAfter: number | null;
  uplift: number | null;
  /** after / expected − 1, when expected is above zero. */
  upliftPct: number | null;
  resultsAfter: number;
  clicksAfter: number;
  phoneAfter: number;
  /** Over all the days' buckets: exposure (impressions in the 0–20 minute window) against sessions above the baseline. */
  correlation: number | null;
  /** Impressions, sessions and baseline summed per bucket over the days. */
  profile: { impressions: number[]; sessions: number[]; baseline: number[] };
};

/** The campaign so far: the days' figures summed, the correlation over all their buckets. */
export function summarise(days: DayUplift[], baseline: number[] | null): UpliftSummary {
  const sum = (f: (d: DayUplift) => number) => days.reduce((a, d) => a + f(d), 0);
  const withBaseline = days.filter((d) => d.expectedAfter !== null);
  const expected = withBaseline.length ? round2(sum((d) => d.expectedAfter ?? 0)) : null;
  const after = sum((d) => d.sessionsAfter);
  const profile = {
    impressions: new Array<number>(BUCKETS).fill(0),
    sessions: new Array<number>(BUCKETS).fill(0),
    baseline: new Array<number>(BUCKETS).fill(0),
  };
  const xs: number[] = [];
  const ys: number[] = [];
  for (const d of days) {
    const x = exposure(d.buckets.map(([imp]) => imp));
    for (let b = 0; b < BUCKETS; b++) {
      const [imp, sess] = d.buckets[b] ?? [0, 0];
      profile.impressions[b]! += imp;
      profile.sessions[b]! += sess;
      profile.baseline[b]! += baseline?.[b] ?? 0;
      xs.push(x[b]!);
      ys.push(sess - (baseline?.[b] ?? 0));
    }
  }
  const upliftTotal = withBaseline.length ? round2(sum((d) => d.uplift ?? 0)) : null;
  return {
    days: days.length,
    impressions: sum((d) => d.impressions),
    sessionsAfter: after,
    expectedAfter: expected,
    uplift: upliftTotal,
    upliftPct:
      expected !== null && expected > 0
        ? Math.round((sum((d) => d.sessionsAfter) / expected - 1) * 100)
        : null,
    resultsAfter: sum((d) => d.resultsAfter),
    clicksAfter: sum((d) => d.clicksAfter),
    phoneAfter: sum((d) => d.phoneAfter),
    correlation: days.some((d) => d.tvBuckets > 0) ? roundOrNull(correlation(xs, ys), 3) : null,
    profile,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function roundOrNull(v: number | null, digits: number): number | null {
  if (v === null) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
