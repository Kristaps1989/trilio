import { createHash, randomUUID } from "node:crypto";
import type { AdsProvider, AdsChange, ApplyResult, Known, StatRow, TermRow } from "./provider";

// A stand-in for Google Ads (ADS_PROVIDER=mock): every change succeeds with a
// made-up resource name, and reports are deterministic numbers derived from
// the resource and the day, plus a few search terms per ad group, some of
// them plainly irrelevant, so the optimiser has something to act on.

function n(seed: string, max: number): number {
  return createHash("sha256").update(seed).digest().readUInt32BE(0) % (max + 1);
}

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T12:00:00Z`);
    d <= new Date(`${to}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  )
    out.push(d.toISOString().slice(0, 10));
  return out;
}

const NOISE = ["remonts", "rezerves daļas", "lietots"];

export function mockProvider(): AdsProvider {
  return {
    name: "mock",
    async report(from: string, to: string, known: Known) {
      const stats: StatRow[] = [];
      const terms: TermRow[] = [];
      for (const day of days(from, to)) {
        const row = (level: StatRow["level"], resource: string, scale: number): StatRow => {
          const impressions = n(`${resource}|${day}|i`, 40 * scale);
          const clicks = Math.min(impressions, n(`${resource}|${day}|c`, 4 * scale));
          return {
            level,
            resource,
            day,
            impressions,
            clicks,
            costMicros: clicks * (80_000 + n(`${resource}|${day}|p`, 220_000)),
            conversions: n(`${resource}|${day}|v`, 10) > 7 ? 1 : 0,
          };
        };
        for (const c of known.campaigns) stats.push(row("campaign", c, 10));
        for (const g of known.adGroups) stats.push(row("ad_group", g, 3));
        for (const k of known.keywords) {
          stats.push(row("keyword", k.resource, 1));
          const relevant = row("keyword", `${k.resource}|t`, 1);
          terms.push({ day, adGroup: k.adGroup, term: k.text, ...pick(relevant) });
        }
        for (const g of known.adGroups) {
          const noise = NOISE[n(`${g}|${day}|w`, NOISE.length - 1)]!;
          const first = known.keywords.find((k) => k.adGroup === g);
          if (!first) continue;
          const r = row("keyword", `${g}|${noise}`, 1);
          terms.push({ day, adGroup: g, term: `${first.text} ${noise}`, ...pick(r), conversions: 0 });
        }
      }
      return { stats, terms };
    },
    async apply(change: AdsChange): Promise<ApplyResult> {
      const id = `mock/${change.op}/${randomUUID().slice(0, 8)}`;
      if (change.op === "create_campaign" || change.op === "create_pmax")
        return { ok: true, id, budget: `mock/budget/${randomUUID().slice(0, 8)}` };
      return { ok: true, id };
    },
  };
}

function pick(r: StatRow) {
  return {
    impressions: r.impressions,
    clicks: r.clicks,
    costMicros: r.costMicros,
    conversions: r.conversions,
  };
}
