import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  adAds,
  adAgentRuns,
  adCampaigns,
  adDailyStats,
  adGroups,
  adKeywords,
  adProposals,
  adSearchTerms,
  type AdProposal,
} from "@/db/schema";
import { rigaDay } from "@/domain/analytics/visits";
import { costPerConversion } from "@/domain/ads/budget";
import {
  ACTIONS,
  checkProposal,
  CPC_MAX_CENTS,
  CPC_MIN_CENTS,
  MAX_CHANGES_PER_DAY,
  type Proposal,
} from "@/domain/ads/guardrails";
import { DESCRIPTION_MAX, HEADLINE_MAX } from "@/domain/ads/honesty";
import { wrapUntrusted, type StructuredCaller } from "@/services/llm/client";
import { pullSearchConsole, type SearchConsole } from "@/services/seo/search-console";
import {
  accountState,
  applyProposal,
  conversionsByDay,
  dayOffset,
  getSettings,
  paceBudgets,
  performance,
  pullReports,
  updateSettings,
} from "./account";
import type { AdsProvider } from "./provider";

// The optimiser (docs/GROWTH_PLAN.md §5, Phase 2). Every morning after 06:30
// Riga time, code pulls Google's numbers and Search Console and paces the
// budget by rule. On the review day (weekly by default, the owner's choice:
// at a small budget one day's data is noise) Haiku reads the search terms and
// one Opus call proposes changes from a closed set. Code checks each
// proposal; the owner's mode decides whether it is applied, waits for
// approval, or is only shown. The weekly review adds a strategy memo.

export const OPTIMISER_MODEL = "claude-opus-5-5";
export const TERMS_MODEL = "claude-haiku-5-5";
export const RUN_AFTER = { hour: 6, minute: 30 };

const SYSTEM = `You manage the Google Search ads of Trilio (trilio.lv), a Latvian site that helps shoppers choose a household appliance: a few questions, then the three best options from partner shops' live inventory, ranked by deterministic code. Trilio earns a commission when a visitor buys after clicking through to a shop, and sells some products itself to people who saved them. Ads must bring visitors who click through to a shop or save a product.

At each review (weekly by default, daily if the owner chose so) you get the account as JSON: the owner's settings, Trilio's own conversions per campaign (shop clicks and saves credited to ad visits, weighted as the settings say), Google's numbers for campaigns, ad groups and keywords over 7 and 28 days, search terms with Claude Haiku's relevance label, and the current ads.

Propose changes that lower the cost per weighted conversion or find more converting searches. Use only these actions, with the ids given in the data:
- add_negative {campaignId, text, match: phrase|exact}: a search term that spends without converting and is not about buying that appliance (repairs, parts, manuals, jobs, second-hand, other products).
- pause_keyword {keywordId} / enable_keyword {keywordId}.
- add_keyword {adGroupId, text, match: phrase|exact}: a search term that converted and is not yet a keyword. Latvian words, digits and model codes only, at most 6 words.
- set_cpc {adGroupId, cpcCapCents}: between ${CPC_MIN_CENTS} and ${CPC_MAX_CENTS} cents, at most half up or down from now.
- move_budget {fromCampaignId, toCampaignId, cents}: at most 20 % of the source campaign's budget; the total never changes.
- new_ad {adGroupId, headlines[3–15], descriptions[2–4]}: Latvian, headlines at most ${HEADLINE_MAX} characters, descriptions at most ${DESCRIPTION_MAX}.
- flag_landing {adGroupId, note}: a landing page that gets clicks but almost no shop clicks or saves; nothing is changed, the owner reads the note.

Rules that code enforces and you must follow too: at most ${MAX_CHANGES_PER_DAY} changes per review; never block a search that converted; ad text is honest: no "cheapest", "guaranteed", discounts, percentages, urgency ("tikai šodien", "pēdējā iespēja"), superlatives or numbers that the landing page does not show; no shop or brand names in ad text. You cannot change campaign status, geography, language, conversion settings or the total budget; the budget follows a rule in code.

Every proposal carries every field. Fill the ones its action uses (listed above) and leave the others empty: "" for text and ids, 0 for numbers, [] for lists, "none" for match.

Prefer few, well-founded changes over many small ones. With little data (fewer than about 30 clicks in an ad group over 28 days) propose nothing for it except clear negatives. Give each proposal a one-sentence reason with the numbers behind it, the expected effect, and your confidence 0–100. Then a summary of the period since the last review in two or three Latvian sentences for the owner.`;

// Every field is required: the API compiles the schema into a grammar, and each
// optional field roughly doubles it. With 12 optional fields the request was
// refused ("Schema is too complex"). Fields an action does not use come back
// empty ("", 0, [], "none") and are dropped in toProposal.
const ProposalOut = z.object({
  action: z.enum(ACTIONS as [string, ...string[]]),
  campaignId: z.string(),
  adGroupId: z.string(),
  keywordId: z.string(),
  fromCampaignId: z.string(),
  toCampaignId: z.string(),
  text: z.string(),
  match: z.enum(["phrase", "exact", "none"]),
  cpcCapCents: z.number().int(),
  cents: z.number().int(),
  headlines: z.array(z.string()),
  descriptions: z.array(z.string()),
  note: z.string(),
  reason: z.string(),
  expectedEffect: z.string(),
  confidence: z.number().int(),
});

/** A proposal's empty fields, for building one by hand (tests, the e2e stand-in for Claude). */
export const EMPTY_PROPOSAL_FIELDS = {
  campaignId: "",
  adGroupId: "",
  keywordId: "",
  fromCampaignId: "",
  toCampaignId: "",
  text: "",
  match: "none",
  cpcCapCents: 0,
  cents: 0,
  headlines: [],
  descriptions: [],
  note: "",
} as const;

export const OptimiserOutput = z.object({ summary: z.string(), proposals: z.array(ProposalOut) });

export const TermsOutput = z.object({
  terms: z.array(z.object({ term: z.string(), label: z.enum(["relevant", "irrelevant", "unsure"]) })),
});

export const MemoOutput = z.object({ memo: z.string() });

export type OptimiserDeps = {
  provider: AdsProvider;
  caller: StructuredCaller;
  searchConsole?: SearchConsole | null;
  now?: Date;
  /** Run even before 06:30 or when today's run exists ("Palaist tagad"). */
  force?: boolean;
};

/** True when Claude reviews today: every day, or on the owner's weekday. */
export function reviewDue(
  settings: { reviewCadence: string; reviewWeekday: number },
  weekday: number,
): boolean {
  return settings.reviewCadence === "daily" || weekday === settings.reviewWeekday;
}

/** The Riga day (YYYY-MM-DD) of the next review, today included when it has not run yet. */
export function nextReviewDay(
  settings: { reviewCadence: string; reviewWeekday: number },
  now: Date,
  ranToday: boolean,
): string {
  for (let i = ranToday ? 1 : 0; i <= 7; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    if (reviewDue(settings, rigaClock(d).weekday)) return rigaDay(d);
  }
  return rigaDay(now);
}

function rigaClock(d: Date): { hour: number; minute: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Riga",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(String(parts.weekday)) + 1;
  return { hour: Number(parts.hour), minute: Number(parts.minute), weekday };
}

/** Reads unlabelled search terms with Haiku: is the searcher looking to buy this kind of appliance? */
async function labelTerms(db: Db, caller: StructuredCaller, since: string): Promise<number> {
  const rows = await db
    .select({ term: adSearchTerms.term, group: adGroups.name })
    .from(adSearchTerms)
    .innerJoin(adGroups, eq(adGroups.id, adSearchTerms.adGroupId))
    .where(and(isNull(adSearchTerms.label), gte(adSearchTerms.day, since)))
    .groupBy(adSearchTerms.term, adGroups.name)
    // The ones that cost most first: they are the ones worth a negative.
    .orderBy(desc(sql`sum(${adSearchTerms.costMicros})`))
    .limit(200);
  if (rows.length === 0) return 0;
  const res = await caller({
    purpose: "ads_terms",
    model: TERMS_MODEL,
    system:
      "Label Latvian search terms that triggered a shopping ad for a household appliance category. relevant: the searcher may want to buy an appliance of that category. irrelevant: repairs, spare parts, manuals, jobs, rentals, second-hand, another product, or no buying intent. unsure: cannot tell. Return every term once, unchanged.",
    user: wrapUntrusted("search_terms", rows.map((r) => `${r.group}: ${r.term}`).join("\n")),
    schema: TermsOutput,
    maxTokens: 6000,
    cache: false,
    timeoutMs: 60_000,
  });
  if (!res.ok) return 0;
  const terms = new Map(rows.map((r) => [r.term, true]));
  let n = 0;
  for (const t of res.value.terms) {
    const term = t.term.replace(/^[^:]+:\s*/, "").toLowerCase();
    if (!terms.has(term)) continue;
    await db
      .update(adSearchTerms)
      .set({ label: t.label })
      .where(and(eq(adSearchTerms.term, term), isNull(adSearchTerms.label)));
    n++;
  }
  return n;
}

const eur = (micros: number) => Math.round(micros / 10_000) / 100;

/** The account as Claude reads it: compact, ids included, numbers rounded. */
export async function optimiserContext(db: Db, now = new Date()) {
  const settings = await getSettings(db);
  const d7 = dayOffset(now, 7);
  const d28 = dayOffset(now, 28);
  const yesterday = dayOffset(now, 1);
  const statsSince = async (level: string, since: string) => {
    const rows = await db
      .select({
        id: adDailyStats.entityId,
        impressions: sql<number>`sum(${adDailyStats.impressions})::int`,
        clicks: sql<number>`sum(${adDailyStats.clicks})::int`,
        micros: sql<number>`sum(${adDailyStats.costMicros})::bigint`,
        conversions: sql<number>`sum(${adDailyStats.conversions})::float`,
      })
      .from(adDailyStats)
      .where(
        and(eq(adDailyStats.level, level), gte(adDailyStats.day, since), lte(adDailyStats.day, yesterday)),
      )
      .groupBy(adDailyStats.entityId);
    return new Map(
      rows.map((r) => [
        r.id,
        {
          impressions: Number(r.impressions),
          clicks: Number(r.clicks),
          costEur: eur(Number(r.micros)),
          googleConversions: Number(r.conversions),
        },
      ]),
    );
  };
  const [c7, c28, g28, k28] = await Promise.all([
    statsSince("campaign", d7),
    statsSince("campaign", d28),
    statsSince("ad_group", d28),
    statsSince("keyword", d28),
  ]);
  const campaigns = await db
    .select()
    .from(adCampaigns)
    .where(sql`${adCampaigns.status} <> 'removed'`);
  const groups = await db.select().from(adGroups);
  const keywords = await db
    .select()
    .from(adKeywords)
    .where(sql`${adKeywords.status} <> 'removed'`);
  const ads = await db
    .select()
    .from(adAds)
    .where(sql`${adAds.status} <> 'removed'`);
  const terms = await db
    .select({
      adGroupId: adSearchTerms.adGroupId,
      term: adSearchTerms.term,
      label: sql<string | null>`max(${adSearchTerms.label})`,
      clicks: sql<number>`sum(${adSearchTerms.clicks})::int`,
      micros: sql<number>`sum(${adSearchTerms.costMicros})::bigint`,
      conversions: sql<number>`sum(${adSearchTerms.conversions})::float`,
    })
    .from(adSearchTerms)
    .where(gte(adSearchTerms.day, d28))
    .groupBy(adSearchTerms.adGroupId, adSearchTerms.term)
    .orderBy(desc(sql`sum(${adSearchTerms.costMicros})`))
    .limit(200);
  const perf = await performance(db, now);
  const ownConversions = await conversionsByDay(db, d28, yesterday);
  return {
    today: rigaDay(now),
    settings: {
      dailyBudgetEur: settings.dailyBudgetCents / 100,
      floorEur: settings.floorCents / 100,
      targetCostPerConversionEur: settings.targetCostCents === null ? null : settings.targetCostCents / 100,
      weights: { shopClick: settings.clickWeight, save: settings.saveWeight },
    },
    last7Days: {
      costEur: perf.cost7dCents / 100,
      shopClicksFromAds: perf.shopClicks7d,
      savesFromAds: perf.saves7d,
      costPerWeightedConversionEur: ((c) => (c === null ? null : c / 100))(costPerConversion(perf, settings)),
    },
    trilioConversionsByCampaignTag: ownConversions.reduce<
      Record<string, { visits: number; shopClicks: number; saves: number }>
    >((acc, r) => {
      const k = r.campaign ?? "(none)";
      acc[k] ??= { visits: 0, shopClicks: 0, saves: 0 };
      acc[k].visits += r.visits;
      acc[k].shopClicks += r.shopClicks;
      acc[k].saves += r.saves;
      return acc;
    }, {}),
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      budgetEur: c.budgetCents / 100,
      last7: c7.get(c.id) ?? null,
      last28: c28.get(c.id) ?? null,
    })),
    adGroups: groups.map((g) => ({
      id: g.id,
      campaignId: g.campaignId,
      name: g.name,
      landing: g.landingPath,
      cpcCapCents: g.cpcCapCents,
      last28: g28.get(g.id) ?? null,
      keywords: keywords
        .filter((k) => k.adGroupId === g.id)
        .map((k) => ({
          id: k.id,
          text: k.text,
          match: k.match,
          status: k.status,
          last28: k28.get(k.id) ?? null,
        })),
      ads: ads
        .filter((a) => a.adGroupId === g.id)
        .map((a) => ({ headlines: a.headlines, descriptions: a.descriptions })),
      searchTerms: terms
        .filter((t) => t.adGroupId === g.id)
        .slice(0, 20)
        .map((t) => ({
          term: t.term,
          label: t.label,
          clicks: Number(t.clicks),
          costEur: eur(Number(t.micros)),
          googleConversions: Number(t.conversions),
        })),
    })),
    negatives: keywords.filter((k) => k.negative).map((k) => ({ campaignId: k.campaignId, text: k.text })),
  };
}

/** The proposal's own fields for the guardrails: the empty ones and the explanation dropped. */
export function toProposal(p: z.infer<typeof ProposalOut>): Record<string, unknown> {
  const meta = new Set(["reason", "expectedEffect", "confidence"]);
  const empty = (v: unknown) =>
    v === undefined || v === "" || v === 0 || v === "none" || (Array.isArray(v) && v.length === 0);
  return Object.fromEntries(Object.entries(p).filter(([k, v]) => !meta.has(k) && !empty(v)));
}

/** One optimiser run. Returns null when it was not due. */
export async function runDaily(db: Db, deps: OptimiserDeps) {
  const now = deps.now ?? new Date();
  const day = rigaDay(now);
  const clock = rigaClock(now);
  if (!deps.force && clock.hour * 60 + clock.minute < RUN_AFTER.hour * 60 + RUN_AFTER.minute) return null;
  if (deps.force)
    await db.delete(adAgentRuns).where(and(eq(adAgentRuns.kind, "daily"), eq(adAgentRuns.day, day)));
  const [run] = await db.insert(adAgentRuns).values({ kind: "daily", day }).onConflictDoNothing().returning();
  if (!run) return null;
  const finish = (patch: Partial<typeof adAgentRuns.$inferInsert>) =>
    db
      .update(adAgentRuns)
      .set({ finishedAt: new Date(), ...patch })
      .where(eq(adAgentRuns.id, run.id));
  try {
    const settings = await getSettings(db);
    // Up to today: Google's numbers for today are partial but real, and the admin shows them.
    await pullReports(db, deps.provider, dayOffset(now, 28), dayOffset(now, 0));
    await updateSettings(db, { reportsSyncedAt: now, reportsError: null });
    if (deps.searchConsole)
      await pullSearchConsole(db, deps.searchConsole, dayOffset(now, 28), dayOffset(now, 3)).catch((err) =>
        console.error("search console:", (err as Error).message),
      );
    const paced = settings.paused ? { cents: 0, why: "paused" } : await paceBudgets(db, deps.provider, now);
    const budgetLine = `Budžets rītdienai: ${(paced.cents / 100).toFixed(2)} € (${paced.why}).`;
    if (!deps.force && !reviewDue(settings, clock.weekday)) {
      await finish({
        ok: true,
        summary: `Dati atjaunināti; Claude pārskats ${nextReviewDay(settings, now, true)}. ${budgetLine}`,
      });
      return { ok: true as const, reviewed: false, proposals: 0, applied: 0, blocked: 0 };
    }
    const [{ n: campaigns } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(adCampaigns)
      .where(sql`${adCampaigns.status} <> 'removed'`);
    if (campaigns === 0) {
      await finish({ ok: true, summary: "Nav kampaņu: vispirms “Izveidot kampaņas no kategorijām”." });
      return { ok: true as const, reviewed: false, proposals: 0, applied: 0, blocked: 0 };
    }
    await labelTerms(db, deps.caller, dayOffset(now, 28));

    const context = await optimiserContext(db, now);
    const res = await deps.caller({
      purpose: "ads_optimiser",
      model: OPTIMISER_MODEL,
      system: SYSTEM,
      user: wrapUntrusted("account", JSON.stringify(context)),
      schema: OptimiserOutput,
      maxTokens: 16000,
      effort: "high",
      timeoutMs: 300_000,
      maxRetries: 1,
    });
    if (!res.ok) {
      await finish({
        ok: false,
        error: `claude: ${res.reason}${"detail" in res && res.detail ? ` — ${res.detail}` : ""}`.slice(
          0,
          500,
        ),
        summary: budgetLine,
      });
      return { ok: false as const, reason: res.reason };
    }
    let applied = 0;
    let blocked = 0;
    let state = await accountState(db, now);
    for (const out of res.value.proposals.slice(0, 60)) {
      const raw = toProposal(out);
      const verdict = checkProposal(raw, state);
      const [row] = await db
        .insert(adProposals)
        .values({
          runId: run.id,
          action: out.action,
          params: raw,
          reason: out.reason.slice(0, 600),
          expectedEffect: out.expectedEffect.slice(0, 300),
          confidence: Math.max(0, Math.min(100, out.confidence)),
          status: verdict.ok ? "proposed" : "blocked",
          blockReason: verdict.ok ? null : verdict.reason,
        })
        .returning();
      if (!verdict.ok) {
        blocked++;
        continue;
      }
      const auto =
        settings.mode === "auto" &&
        !settings.paused &&
        (settings.autoActions as string[]).includes(out.action);
      if (auto && verdict.proposal) {
        const r = await applyProposal(db, deps.provider, row!, verdict.proposal, "auto");
        if (r.ok) applied++;
        state = await accountState(db, now);
      }
    }
    const summary = `${res.value.summary.slice(0, 1200)} ${budgetLine}`;
    await finish({ ok: true, summary, proposals: res.value.proposals.length, applied, blocked });
    // The memo comes with the weekly review, or on Mondays when the owner chose daily reviews.
    if (deps.force || settings.reviewCadence === "weekly" || clock.weekday === 1)
      await runWeeklyMemo(db, deps, now).catch(() => undefined);
    return { ok: true as const, reviewed: true, proposals: res.value.proposals.length, applied, blocked };
  } catch (err) {
    await finish({ ok: false, error: (err as Error).message.slice(0, 500) });
    return { ok: false as const, reason: "error" };
  }
}

/** The Monday memo: what worked, what to stop, categories, budget, what was blocked. */
export async function runWeeklyMemo(db: Db, deps: OptimiserDeps, now = new Date()) {
  const day = rigaDay(now);
  const [prev] = await db
    .select()
    .from(adAgentRuns)
    .where(and(eq(adAgentRuns.kind, "weekly")))
    .orderBy(desc(adAgentRuns.day))
    .limit(1);
  if (prev?.day === day && !deps.force) return null;
  const week = await db
    .select({
      action: adProposals.action,
      status: adProposals.status,
      reason: adProposals.reason,
      block: adProposals.blockReason,
    })
    .from(adProposals)
    .where(gte(adProposals.createdAt, new Date(now.getTime() - 7 * 86_400_000)))
    .limit(200);
  const res = await deps.caller({
    purpose: "ads_optimiser",
    model: OPTIMISER_MODEL,
    system: `${SYSTEM}\n\nThis time write the weekly strategy memo for the owner instead of proposals: in Latvian, Markdown, at most 350 words, sections "Kas strādāja", "Ko apturēt", "Kategorijas", "Budžets", "Bloķētie priekšlikumi". Numbers from the data only.`,
    user: wrapUntrusted(
      "week",
      JSON.stringify({
        account: await optimiserContext(db, now),
        proposals: week,
        ownerNote: prev?.ownerNote ?? null,
      }),
    ),
    schema: MemoOutput,
    maxTokens: 8000,
    effort: "high",
    timeoutMs: 300_000,
    maxRetries: 1,
  });
  if (!res.ok) return null;
  await db
    .insert(adAgentRuns)
    .values({ kind: "weekly", day, ok: true, finishedAt: new Date(), memo: res.value.memo.slice(0, 8000) })
    .onConflictDoUpdate({
      target: [adAgentRuns.kind, adAgentRuns.day],
      set: { memo: res.value.memo.slice(0, 8000), ok: true },
    });
  return res.value.memo;
}

/** The owner's decision on a proposal; approval re-checks the guardrails against the account as it is now. */
export async function decideProposal(
  db: Db,
  provider: AdsProvider,
  row: AdProposal,
  approve: boolean,
  by: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (row.status !== "proposed") return { ok: false, reason: "already decided" };
  if (!approve) {
    await db
      .update(adProposals)
      .set({ status: "rejected", decidedBy: by, decidedAt: new Date() })
      .where(eq(adProposals.id, row.id));
    return { ok: true };
  }
  const verdict = checkProposal(row.params, await accountState(db));
  if (!verdict.ok || !verdict.proposal) {
    await db
      .update(adProposals)
      .set({
        status: "blocked",
        blockReason: verdict.ok ? "invalid" : verdict.reason,
        decidedBy: by,
        decidedAt: new Date(),
      })
      .where(eq(adProposals.id, row.id));
    return { ok: false, reason: verdict.ok ? "invalid" : verdict.reason };
  }
  const r = await applyProposal(db, provider, row, verdict.proposal as Proposal, by);
  return { ok: r.ok, reason: r.error };
}
