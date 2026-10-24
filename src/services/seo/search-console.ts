import { createHash } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { seoQueries } from "@/db/schema";
import {
  googleCredentialsFromEnv,
  googleTokenSource,
  SEARCH_CONSOLE_SCOPE,
  type GoogleCredentials,
} from "@/services/ads/google";

// Search Console queries and pages (docs/GROWTH_PLAN.md, SEO track), read
// with the same Google credentials as the ads account (scope
// webmasters.readonly; a service account must be an owner of the property). The SEO page lists queries where Trilio ranks 5–20:
// the ones content can lift.

export type SeoRow = {
  day: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
};

export interface SearchConsole {
  rows(from: string, to: string): Promise<SeoRow[]>;
}

export function searchConsoleFromEnv(
  env: Record<string, string | undefined> = process.env,
): SearchConsole | null {
  if (env.FEATURE_ADS !== "1") return null;
  if (env.ADS_PROVIDER === "mock") return mockSearchConsole();
  const site = env.SEARCH_CONSOLE_SITE;
  const credentials = googleCredentialsFromEnv(env);
  if (!site || !credentials) return null;
  return googleSearchConsole(site, credentials);
}

export function googleSearchConsole(
  site: string,
  credentials: GoogleCredentials,
  fetchImpl: typeof fetch = fetch,
): SearchConsole {
  const token = googleTokenSource(credentials, SEARCH_CONSOLE_SCOPE, fetchImpl);
  return {
    async rows(from, to) {
      const res = await fetchImpl(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
          body: JSON.stringify({
            startDate: from,
            endDate: to,
            dimensions: ["date", "query", "page"],
            rowLimit: 5000,
          }),
        },
      );
      if (!res.ok) throw new Error(`search console ${res.status}`);
      const body = (await res.json()) as {
        rows?: { keys: string[]; clicks: number; impressions: number; position: number }[];
      };
      return (body.rows ?? []).map((r) => ({
        day: r.keys[0]!,
        query: r.keys[1]!,
        page: new URL(r.keys[2]!).pathname,
        clicks: r.clicks,
        impressions: r.impressions,
        position: r.position,
      }));
    },
  };
}

const MOCK_QUERIES: [string, string][] = [
  ["labākais ledusskapis", "/kategorija/fridge"],
  ["ledusskapis līdz 800", "/kategorija/fridge/lidz-800"],
  ["kluss putekļsūcējs", "/kategorija/vacuum"],
  ["veļas mašīna šaura", "/kategorija/washer"],
  ["karstā gaisa friteris", "/kategorija/airfryer"],
];

export function mockSearchConsole(): SearchConsole {
  const n = (s: string, max: number) => createHash("sha256").update(s).digest().readUInt32BE(0) % (max + 1);
  return {
    async rows(from, to) {
      const out: SeoRow[] = [];
      for (
        let d = new Date(`${from}T12:00:00Z`);
        d <= new Date(`${to}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        const day = d.toISOString().slice(0, 10);
        for (const [query, page] of MOCK_QUERIES) {
          const impressions = 5 + n(`${query}|${day}`, 60);
          out.push({
            day,
            query,
            page,
            impressions,
            clicks: n(`${query}|${day}|c`, 3),
            position: 4 + n(query, 14),
          });
        }
      }
      return out;
    },
  };
}

export async function pullSearchConsole(
  db: Db,
  sc: SearchConsole,
  from: string,
  to: string,
): Promise<number> {
  const rows = await sc.rows(from, to);
  const values = rows.map((r) => ({
    day: r.day,
    query: r.query.slice(0, 200),
    page: r.page.slice(0, 200),
    clicks: r.clicks,
    impressions: r.impressions,
    position: r.position,
  }));
  for (let i = 0; i < values.length; i += 500)
    await db
      .insert(seoQueries)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [seoQueries.day, seoQueries.query, seoQueries.page],
        set: {
          clicks: sql`excluded.clicks`,
          impressions: sql`excluded.impressions`,
          position: sql`excluded.position`,
        },
      });
  return rows.length;
}

/** Queries over the last 28 days where the average position is 5–20: page two and the bottom of page one. */
export async function seoOpportunities(db: Db, since: string, limit = 50) {
  return db
    .select({
      query: seoQueries.query,
      page: seoQueries.page,
      clicks: sql<number>`sum(${seoQueries.clicks})::int`,
      impressions: sql<number>`sum(${seoQueries.impressions})::int`,
      position: sql<number>`round(avg(${seoQueries.position})::numeric, 1)::float`,
      done: sql<boolean>`bool_or(${seoQueries.done})`,
    })
    .from(seoQueries)
    .where(gte(seoQueries.day, since))
    .groupBy(seoQueries.query, seoQueries.page)
    .having(sql`avg(${seoQueries.position}) between 5 and 20`)
    .orderBy(desc(sql`sum(${seoQueries.impressions})`))
    .limit(limit);
}

export async function markSeoDone(db: Db, query: string, page: string): Promise<void> {
  await db
    .update(seoQueries)
    .set({ done: true })
    .where(and(eq(seoQueries.query, query), eq(seoQueries.page, page)));
}
