import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { adAgentRuns, seoOverrides, seoQueries, type SeoOverride } from "@/db/schema";
import { rigaDay } from "@/domain/analytics/visits";
import { getSubcategory } from "@/domain/questions/catalog";
import {
  checkSeoText,
  landingOf,
  pickPages,
  REST_DAYS,
  TRIAL_DAYS,
  trialVerdict,
  type PageSearch,
  type SearchNumbers,
} from "@/domain/seo/agent";
import { wrapUntrusted, type StructuredCaller } from "@/services/llm/client";

// The SEO agent (docs/GROWTH_PLAN.md, "One agent for every channel", part 2). Once a week it
// reads what Search Console says about the category pages, and for up to three pages that are
// seen but not clicked it has Claude write a new title and description from the searches
// people really made. Code checks every text (lengths, the category named, the honesty rules)
// and judges every change three weeks later: one that lost clicks is taken back. In the
// owner's "manage" mode a checked text goes live at once; otherwise it waits for approval.

export const SEO_MODEL = "claude-opus-5-5";

const SYSTEM = `You write the title and meta description that Google shows for a category page of Trilio (trilio.lv), a Latvian site that helps a shopper choose a household appliance: the page lists the three options that fit best from partner shops' live stock, with today's prices and the reason for each, and the visitor can answer a few questions to get their own three or ask Trilio for a lower price.

You get the page (category, budget if it has one, the year), its current title and description, and the searches it was shown for in the last 28 days with impressions, clicks and average position. The page is seen but clicked less than an ordinary result at its position. Write a title and a description that a person who typed those searches would click, in natural Latvian with correct grammar and cases.

Rules, all checked by code afterwards:
- title: at most 60 characters. It names the category in the words people searched, and says what the page gives (the best three, compared, with prices). The year may be used.
- description: 110 to 155 characters, one or two sentences: what the visitor finds on the page and what they can do next.
- Only facts of the page. No "cheapest" or "lowest price" claim, no guarantee, no discount or percentage, no urgency, no shop or brand names, no superlatives about Trilio. The only numbers allowed are in numbersYouMayUse.
- Do not stuff keywords, do not write in capitals, do not repeat the current title with words swapped: change what a searcher would notice.

Also give "why": one Latvian sentence for the owner, naming the search the new text answers.`;

export const SeoCopy = z.object({ title: z.string(), description: z.string(), why: z.string() });

const numbers = (r: { impressions: unknown; clicks: unknown; position: unknown }): SearchNumbers => ({
  impressions: Number(r.impressions ?? 0),
  clicks: Number(r.clicks ?? 0),
  position: Math.round(Number(r.position ?? 0) * 10) / 10,
});

/** What Search Console says about each page between two days, with its searches. */
export async function pageSearch(db: Db, from: string, to?: string): Promise<PageSearch[]> {
  const rows = await db
    .select({
      path: seoQueries.page,
      query: seoQueries.query,
      impressions: sql<number>`sum(${seoQueries.impressions})::int`,
      clicks: sql<number>`sum(${seoQueries.clicks})::int`,
      // Weighted by impressions: a position seen once does not move the average.
      position: sql<number>`(sum(${seoQueries.position} * ${seoQueries.impressions}) / nullif(sum(${seoQueries.impressions}), 0))::float`,
    })
    .from(seoQueries)
    .where(and(gte(seoQueries.day, from), to ? sql`${seoQueries.day} <= ${to}` : undefined))
    .groupBy(seoQueries.page, seoQueries.query);
  const pages = new Map<string, PageSearch>();
  for (const r of rows) {
    const n = numbers(r);
    if (n.impressions === 0) continue;
    const p = pages.get(r.path) ?? { path: r.path, impressions: 0, clicks: 0, position: 0, queries: [] };
    p.position = (p.position * p.impressions + n.position * n.impressions) / (p.impressions + n.impressions);
    p.impressions += n.impressions;
    p.clicks += n.clicks;
    p.queries.push({ query: r.query, ...n });
    pages.set(r.path, p);
  }
  for (const p of pages.values()) {
    p.position = Math.round(p.position * 10) / 10;
    p.queries.sort((a, b) => b.impressions - a.impressions);
  }
  return [...pages.values()];
}

/** The text a page shows now by the agent's hand, if any. */
export async function seoOverrideFor(db: Db, path: string): Promise<SeoOverride | null> {
  const [row] = await db
    .select()
    .from(seoOverrides)
    .where(and(eq(seoOverrides.path, path), inArray(seoOverrides.status, ["active", "kept"])))
    .orderBy(desc(seoOverrides.appliedAt))
    .limit(1);
  return row ?? null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Judges the changes that have had their three weeks: kept, or taken back. */
export async function judgeTrials(db: Db, now = new Date()): Promise<{ kept: number; reverted: number }> {
  const out = { kept: 0, reverted: 0 };
  const due = await db
    .select()
    .from(seoOverrides)
    .where(
      and(
        eq(seoOverrides.status, "active"),
        sql`${seoOverrides.appliedAt} <= ${new Date(now.getTime() - TRIAL_DAYS * 86_400_000).toISOString()}`,
      ),
    );
  for (const o of due) {
    const since = (await pageSearch(db, day(o.appliedAt!), day(now))).find((p) => p.path === o.path);
    const after: SearchNumbers = since
      ? { impressions: since.impressions, clicks: since.clicks, position: since.position }
      : { impressions: 0, clicks: 0, position: o.before.position };
    const verdict = trialVerdict(o.before, after);
    if (verdict === "wait") continue;
    await db
      .update(seoOverrides)
      .set({ status: verdict === "keep" ? "kept" : "reverted", after, closedAt: now })
      .where(eq(seoOverrides.id, o.id));
    out[verdict === "keep" ? "kept" : "reverted"]++;
  }
  return out;
}

export type SeoRun = {
  ok: boolean;
  kept: number;
  reverted: number;
  written: number;
  applied: number;
  refused: number;
};

/**
 * One weekly round: judge the trials that are due, then write for the pages that are seen and
 * passed over. `apply` true: a checked text goes live now; false: it waits as a proposal.
 * `current` gives a page's present title and description, so Claude sees what to change.
 */
export async function runSeoAgent(
  db: Db,
  deps: {
    caller: StructuredCaller;
    apply: boolean;
    current: (path: string) => Promise<{ title: string; description: string } | null>;
    now?: Date;
  },
): Promise<SeoRun> {
  const now = deps.now ?? new Date();
  const judged = await judgeTrials(db, now);
  const out: SeoRun = { ok: true, ...judged, written: 0, applied: 0, refused: 0 };

  // A page with a change on trial, a proposal waiting, or anything closed in the last four weeks rests.
  const recent = await db
    .select({ path: seoOverrides.path, status: seoOverrides.status, closedAt: seoOverrides.closedAt })
    .from(seoOverrides);
  const restFrom = now.getTime() - REST_DAYS * 86_400_000;
  const resting = new Set(
    recent
      .filter(
        (r) => r.status === "active" || r.status === "proposed" || (r.closedAt?.getTime() ?? 0) >= restFrom,
      )
      .map((r) => r.path),
  );
  const pages = pickPages(await pageSearch(db, day(new Date(now.getTime() - 28 * 86_400_000))), resting);

  for (const page of pages) {
    const landing = landingOf(page.path)!;
    const sub = getSubcategory(landing.sub);
    if (!sub || (landing.budgetEur !== null && !sub.budget_steps_eur.includes(landing.budgetEur))) continue;
    const year = Number(rigaDay(now).slice(0, 4));
    const allowedNumbers = [3, year, ...(landing.budgetEur !== null ? [landing.budgetEur] : [])];
    const res = await deps.caller({
      purpose: "seo_copy",
      model: SEO_MODEL,
      system: SYSTEM,
      user: wrapUntrusted(
        "page",
        JSON.stringify({
          category: sub.label,
          budgetEur: landing.budgetEur,
          year,
          current: await deps.current(page.path),
          last28Days: { impressions: page.impressions, clicks: page.clicks, averagePosition: page.position },
          searches: page.queries.slice(0, 12),
          numbersYouMayUse: allowedNumbers,
        }),
      ),
      schema: SeoCopy,
      maxTokens: 2000,
      effort: "medium",
      timeoutMs: 120_000,
      maxRetries: 1,
    });
    if (!res.ok) {
      out.ok = false;
      continue;
    }
    out.written++;
    const text = { title: res.value.title.trim(), description: res.value.description.trim() };
    if (checkSeoText(text, { category: sub.label, allowedNumbers }).length) {
      out.refused++;
      continue;
    }
    await db.insert(seoOverrides).values({
      path: page.path,
      ...text,
      query: page.queries[0]?.query.slice(0, 200) ?? "",
      why: res.value.why.trim().slice(0, 400),
      status: deps.apply ? "active" : "proposed",
      before: { impressions: page.impressions, clicks: page.clicks, position: page.position },
      appliedAt: deps.apply ? now : null,
    });
    if (deps.apply) out.applied++;
  }
  return out;
}

/** The owner's word on a change: approve a proposal, refuse it, or take back a live one. */
export async function decideSeoOverride(
  db: Db,
  id: string,
  decision: "approve" | "reject" | "revert",
  now = new Date(),
): Promise<boolean> {
  const [row] = await db.select().from(seoOverrides).where(eq(seoOverrides.id, id));
  if (!row) return false;
  if (decision === "approve" && row.status === "proposed") {
    await db.update(seoOverrides).set({ status: "active", appliedAt: now }).where(eq(seoOverrides.id, id));
    return true;
  }
  if (decision === "reject" && row.status === "proposed") {
    await db.update(seoOverrides).set({ status: "rejected", closedAt: now }).where(eq(seoOverrides.id, id));
    return true;
  }
  if (decision === "revert" && (row.status === "active" || row.status === "kept")) {
    await db.update(seoOverrides).set({ status: "reverted", closedAt: now }).where(eq(seoOverrides.id, id));
    return true;
  }
  return false;
}

/** The agent's changes, newest first, for the admin page. */
export async function seoChanges(db: Db, limit = 40) {
  return db.select().from(seoOverrides).orderBy(desc(seoOverrides.createdAt)).limit(limit);
}

/** The weekly run happened today already (one row per day in the agent's run log). */
export async function seoRunDue(db: Db, today: string): Promise<boolean> {
  const [row] = await db
    .insert(adAgentRuns)
    .values({ kind: "seo", day: today })
    .onConflictDoNothing()
    .returning({ id: adAgentRuns.id });
  return !!row;
}
