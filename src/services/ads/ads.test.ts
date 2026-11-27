import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import {
  adAccountChecks,
  adAds,
  adAgentRuns,
  adCampaigns,
  adChanges,
  adCreatives,
  adDailyStats,
  adGroups,
  adKeywords,
  adLandings,
  adProposals,
  adSearchTerms,
  adSettings,
  marketingActions,
  metaAdDaily,
  metaAdEntities,
  metaAgentAds,
  savedItems,
  seoOverrides,
  seoQueries,
  users,
} from "@/db/schema";
import { mockMetaAds } from "@/services/marketing/meta-ads";
import { channelPerformance, metaLeads, runMarketingDaily } from "@/services/marketing/manager";
import { type AdRenderer, ensureAgentAds, type CreatorConfig } from "@/services/marketing/meta-creator";
import {
  decideSeoOverride,
  judgeTrials,
  pageSearch,
  runSeoAgent,
  SeoCopy,
  seoOverrideFor,
} from "@/services/seo/agent";
import { runSeoJob } from "@/services/seo/job";
import { landingTemplateMeta } from "@/services/seo/landing-meta";
import type { PostFacts } from "@/domain/social/captions";
import { adParams } from "@/domain/growth/attribution";
import type { StructuredCaller } from "@/services/llm/client";
import { adLandingFor, purgeAdLandings, recordAdLanding } from "@/services/growth/landings";
import { mockSearchConsole } from "@/services/seo/search-console";
import {
  applyProposal,
  buildCampaigns,
  refreshAds,
  getSettings,
  ACCOUNT_ENTITY,
  paceBudgets,
  setCampaignBudget,
  tuneSearchCampaigns,
  setCampaignsStatus,
  syncReports,
  syncAccount,
  updateSettings,
  dayOffset,
  conversionsByDay,
} from "./account";
import { adsOverview } from "./overview";
import { applyRecommendation, campaignPriorities } from "./priorities";
import { approveCreative, createCreatives, createPmax, templateCopy, writeCopy } from "./creatives";
import type { AdsProvider } from "./provider";
import type { Proposal } from "@/domain/ads/guardrails";
import { mockProvider } from "./mock";
import { accountControl, checkAccount, pauseForeignCampaign, reconcileAccount } from "./control";
import type { CampaignState, Expected } from "@/domain/ads/drift";
import type { AdsChange } from "./provider";
import {
  decideProposal,
  EMPTY_PROPOSAL_FIELDS,
  OptimiserOutput,
  optimiserContext,
  raiseStarvedCaps,
  runDaily,
} from "./optimiser";

// The ads pipeline end to end against the database (docs/GROWTH_PLAN.md):
// build → sync → daily run with a fake Claude → guardrails → owner's decision.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

async function wipe(db: Db) {
  for (const t of [
    adAccountChecks,
    adChanges,
    adAds,
    adProposals,
    adAgentRuns,
    adSearchTerms,
    adCreatives,
    adKeywords,
    adGroups,
    adCampaigns,
    adSettings,
    seoQueries,
    marketingActions,
    metaAdDaily,
    metaAgentAds,
    metaAdEntities,
    seoOverrides,
  ])
    await db.delete(t);
  await db.delete(users).where(sql`${users.email} like 'marketing-test-%'`);
  await db.delete(adLandings).where(sql`${adLandings.path} like '/e2e-ads%'`);
}

run("ads pipeline", { timeout: 60_000 }, () => {
  let db: Db;
  let end: () => Promise<void>;
  const provider = mockProvider();

  beforeAll(async () => {
    const created = createDb(url!);
    db = created.db;
    end = () => created.client.end();
    await wipe(db);
  });
  afterAll(async () => {
    await wipe(db);
    await end();
  });

  it("builds draft campaigns from the categories, with the competitor campaign, and syncs them paused", async () => {
    const built = await buildCampaigns(db);
    expect(built.campaigns).toBe(11);
    expect(built.adGroups).toBe(41);
    expect(await buildCampaigns(db)).toEqual({ campaigns: 0, adGroups: 0, keywords: 0 });
    const synced = await syncAccount(db, provider);
    expect(synced.failed).toBe(0);
    const campaigns = await db.select().from(adCampaigns);
    expect(campaigns.every((c) => c.googleId && c.status === "paused")).toBe(true);
    expect(campaigns.reduce((a, c) => a + c.budgetCents, 0)).toBe((await getSettings(db)).dailyBudgetCents);
    const rivals = await db
      .select()
      .from(adKeywords)
      .where(sql`${adKeywords.text} in ('kurpirkt.lv', 'salidzini.lv')`);
    expect(rivals).toHaveLength(2);
  });

  it("refreshes every ad group's ad from the template and pauses the old one", async () => {
    const before = await db.select().from(adAds);
    expect(before.every((a) => a.status === "enabled")).toBe(true);
    // An ad group synced earlier still points at the first question: the refresh moves it to results.
    const [fridge] = await db
      .select()
      .from(adGroups)
      .where(sql`${adGroups.subcategoryId} = 'fridge'`);
    await db
      .update(adGroups)
      .set({ landingPath: "/izvelies/cool/fridge" })
      .where(sql`${adGroups.id} = ${fridge!.id}`);
    const r = await refreshAds(db, provider);
    expect(r).toEqual({ created: before.length, paused: before.length, failed: 0 });
    const [moved] = await db
      .select()
      .from(adGroups)
      .where(sql`${adGroups.id} = ${fridge!.id}`);
    expect(moved!.landingPath).toBe("/rezultati?sub=fridge&cena=tipiska");
    const urls = await db
      .select({ url: sql<string>`${adChanges.operation}->>'finalUrl'` })
      .from(adChanges)
      .where(
        sql`${adChanges.operation}->>'op' = 'create_ad' and ${adChanges.operation}->>'adGroup' = ${fridge!.googleId}`,
      );
    expect(urls.at(-1)!.url).toMatch(/\/rezultati\?sub=fridge&cena=tipiska$/);
    const after = await db.select().from(adAds);
    expect(
      after
        .filter((a) => a.status === "paused")
        .map((a) => a.id)
        .sort(),
    ).toEqual(before.map((a) => a.id).sort());
    const fresh = after.filter((a) => a.status === "enabled");
    expect(fresh).toHaveLength(before.length);
    expect(
      fresh.every((a) => a.source === "template" && a.headlines.length >= 10 && a.descriptions.length === 4),
    ).toBe(true);
    // The change log carries the display path Google shows under the headline.
    const logged = await db
      .select()
      .from(adChanges)
      .where(
        sql`${adChanges.operation}->>'op' = 'create_ad' and ${adChanges.operation}->>'path2' = 'ledusskapji'`,
      );
    expect(logged.length).toBeGreaterThan(0);
  });

  it("runs the daily optimiser: checked proposals wait, a dishonest ad is blocked, the owner decides", async () => {
    const calls: string[] = [];
    const caller: StructuredCaller = async (req) => {
      calls.push(`${req.purpose}:${req.model ?? ""}`);
      if (req.purpose === "ads_terms") return { ok: false, reason: "disabled" };
      const groups = await db.select().from(adGroups).limit(1);
      const g = groups[0]!;
      if ((req.schema as unknown) !== OptimiserOutput)
        return {
          ok: true,
          value: req.schema.parse({ memo: "## Kas strādāja\n- testi" }),
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      return {
        ok: true,
        value: req.schema.parse({
          summary: "Tests.",
          proposals: [
            {
              ...EMPTY_PROPOSAL_FIELDS,
              action: "set_cpc",
              adGroupId: g.id,
              cpcCapCents: 35,
              reason: "r",
              expectedEffect: "e",
              confidence: 70,
            },
            {
              ...EMPTY_PROPOSAL_FIELDS,
              action: "new_ad",
              adGroupId: g.id,
              headlines: ["Tikai šodien", "B variants", "C variants"],
              descriptions: ["x", "y"],
              reason: "r",
              expectedEffect: "e",
              confidence: 30,
            },
            {
              ...EMPTY_PROPOSAL_FIELDS,
              action: "add_negative",
              campaignId: g.campaignId,
              text: "kurpirkt",
              match: "phrase",
              reason: "r",
              expectedEffect: "e",
              confidence: 50,
            },
          ],
        }),
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    };
    const res = await runDaily(db, { provider, caller, searchConsole: mockSearchConsole(), force: true });
    expect(res).toMatchObject({ ok: true, proposals: 3, applied: 0 });
    expect(calls).toContain("ads_optimiser:claude-opus-5-5");
    expect(calls).toContain("ads_terms:claude-haiku-5-5");
    const proposals = await db.select().from(adProposals);
    const byAction = (a: string) => proposals.find((p) => p.action === a)!;
    expect(byAction("set_cpc").status).toBe("proposed");
    expect(byAction("new_ad").status).toBe("blocked");
    expect(byAction("new_ad").blockReason).toMatch(/urgency/);
    // The competitor names are the campaign's own keywords: a negative may not block them.
    const rivalNegative = proposals.filter((p) => p.action === "add_negative");
    expect(rivalNegative.every((p) => p.status === "blocked" || p.status === "proposed")).toBe(true);
    // Reports landed, and Search Console too.
    expect((await db.select().from(adSearchTerms)).length).toBeGreaterThan(0);
    expect((await db.select().from(seoQueries)).length).toBeGreaterThan(0);
    // A weekly memo is written on a forced run.
    expect(
      (await db.select().from(adAgentRuns)).some(
        (r) => r.kind === "weekly" && r.memo?.includes("Kas strādāja"),
      ),
    ).toBe(true);

    const decided = await decideProposal(db, provider, byAction("set_cpc"), true, "owner@example.invalid");
    expect(decided.ok).toBe(true);
    const [g] = await db
      .select()
      .from(adGroups)
      .where(sql`${adGroups.id} = ${(byAction("set_cpc").params as { adGroupId: string }).adGroupId}`);
    expect(g!.cpcCapCents).toBe(35);
    expect(
      (await db.select().from(adChanges)).some((c) => (c.operation as { op: string }).op === "set_cpc"),
    ).toBe(true);
    expect(
      (await decideProposal(db, provider, { ...byAction("set_cpc"), status: "applied" }, true, "x")).ok,
    ).toBe(false);
  });

  it("applies allowed actions on its own in auto mode, and nothing while paused", async () => {
    await updateSettings(db, { mode: "auto", autoActions: ["set_cpc"] });
    const g = (await db.select().from(adGroups).limit(1))[0]!;
    const caller: StructuredCaller = async (req) =>
      (req.schema as unknown) === OptimiserOutput
        ? {
            ok: true,
            value: req.schema.parse({
              summary: "Auto.",
              proposals: [
                {
                  ...EMPTY_PROPOSAL_FIELDS,
                  action: "set_cpc",
                  adGroupId: g.id,
                  cpcCapCents: 40,
                  reason: "r",
                  expectedEffect: "e",
                  confidence: 70,
                },
              ],
            }),
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        : { ok: false, reason: "disabled" };
    expect(await runDaily(db, { provider, caller, force: true })).toMatchObject({ ok: true, applied: 1 });
    await updateSettings(db, { paused: true });
    expect(await runDaily(db, { provider, caller, force: true })).toMatchObject({
      ok: true,
      applied: 0,
      blocked: 1,
    });
    await updateSettings(db, { paused: false, mode: "approve" });
  });

  it("syncs Google's numbers hourly, today included, with the account total", async () => {
    const now = new Date();
    const first = await syncReports(db, provider, { now, force: true });
    expect(first).toMatchObject({ ok: true });
    expect(first.skipped).toBeUndefined();
    // Not again within the hour, unless asked; after an hour it pulls by itself.
    expect(
      (await syncReports(db, provider, { now: new Date(now.getTime() + 61 * 60_000) })).skipped,
    ).toBeUndefined();
    expect(await syncReports(db, provider, { now: new Date(now.getTime() + 70 * 60_000) })).toEqual({
      ok: true,
      skipped: true,
    });
    expect((await syncReports(db, provider, { now, force: true })).skipped).toBeUndefined();
    const today = dayOffset(now, 0);
    const account = await db
      .select()
      .from(adDailyStats)
      .where(sql`${adDailyStats.level} = 'account' and ${adDailyStats.day} = ${today}`);
    expect(account).toHaveLength(1);
    expect(account[0]!.entityId).toBe(ACCOUNT_ENTITY);
    const o = await adsOverview(db, now);
    expect(o.today.micros).toBe(account[0]!.costMicros);
    expect(o.week.micros).toBeGreaterThanOrEqual(o.today.micros);
    expect(o.week.outsideMicros).toBe(0);
    expect((await getSettings(db)).reportsSyncedAt?.getTime()).toBe(now.getTime());

    const broken: AdsProvider = {
      ...provider,
      report: async () => {
        throw new Error("google ads 403: CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION");
      },
    };
    const failed = await syncReports(db, broken, { force: true });
    expect(failed).toMatchObject({ ok: false, error: expect.stringMatching(/NOT_APPROVED/) });
    expect((await getSettings(db)).reportsError).toMatch(/NOT_APPROVED/);
    await syncReports(db, provider, { force: true });
    expect((await getSettings(db)).reportsError).toBeNull();
  });

  it("reviews weekly: other days only refresh data and pace the budget, without Claude", async () => {
    const calls: string[] = [];
    const caller: StructuredCaller = async (req) => {
      calls.push(req.purpose);
      return (req.schema as unknown) === OptimiserOutput
        ? {
            ok: true,
            value: req.schema.parse({ summary: "Nedēļa.", proposals: [] }),
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        : { ok: false, reason: "disabled" };
    };
    expect((await getSettings(db)).reviewCadence).toBe("weekly");
    const tuesday = new Date("2030-10-29T08:00:00Z");
    expect(await runDaily(db, { provider, caller, now: tuesday })).toMatchObject({
      ok: true,
      reviewed: false,
    });
    expect(calls).toEqual([]);
    const [tue] = await db
      .select()
      .from(adAgentRuns)
      .where(sql`${adAgentRuns.day} = '2030-10-29'`);
    expect(tue!.summary).toMatch(/Claude pārskats 2030-11-04/);
    const monday = new Date("2030-11-04T08:00:00Z");
    expect(await runDaily(db, { provider, caller, now: monday })).toMatchObject({ ok: true, reviewed: true });
    expect(calls).toContain("ads_optimiser");
  });

  it("does not run before 06:30 Riga time unless asked", async () => {
    const early = new Date("2026-10-26T03:00:00Z"); // 05:00 in Riga
    const caller: StructuredCaller = async () => ({ ok: false, reason: "disabled" });
    expect(await runDaily(db, { provider, caller, now: early })).toBeNull();
  });

  it("drafts creatives that pass the honesty rules", async () => {
    const rows = await createCreatives(db, "fridge", templateCopy("fridge"), "template");
    expect(rows.filter((r) => r.kind === "image")).toHaveLength(3);
    expect(rows.find((r) => r.kind === "video_script")?.script?.length).toBeGreaterThanOrEqual(3);
  });

  it("carries out every kind of proposal, and records a platform failure", async () => {
    const [g] = await db
      .select()
      .from(adGroups)
      .where(sql`${adGroups.googleId} is not null`)
      .limit(1);
    const campaigns = await db.select().from(adCampaigns);
    const [c1, c2] = campaigns;
    const [k] = await db
      .select()
      .from(adKeywords)
      .where(sql`${adKeywords.adGroupId} = ${g!.id} and not ${adKeywords.negative}`)
      .limit(1);
    const failing: AdsProvider = { ...provider, apply: async () => ({ ok: false, error: "nope" }) };
    const row = async (p: Proposal) =>
      (
        await db
          .insert(adProposals)
          .values({ action: p.action, params: p as unknown as Record<string, unknown>, reason: "r" })
          .returning()
      )[0]!;
    const proposals: Proposal[] = [
      { action: "flag_landing", adGroupId: g!.id, note: "lēna lapa" },
      { action: "add_negative", campaignId: c1!.id, text: "bez maksas", match: "phrase" },
      { action: "pause_keyword", keywordId: k!.id },
      { action: "enable_keyword", keywordId: k!.id },
      { action: "add_keyword", adGroupId: g!.id, text: "ledusskapis ar saldētavu", match: "phrase" },
      { action: "set_cpc", adGroupId: g!.id, cpcCapCents: 32 },
      { action: "move_budget", fromCampaignId: c1!.id, toCampaignId: c2!.id, cents: 10 },
      {
        action: "new_ad",
        adGroupId: g!.id,
        headlines: ["Ledusskapji", "3 piemērotākie", "Salīdzini cenas"],
        descriptions: ["Atbildi uz dažiem jautājumiem.", "Salīdzini cenas veikalos."],
      },
    ];
    for (const p of proposals) {
      expect((await applyProposal(db, provider, await row(p), p, "owner")).ok).toBe(true);
    }
    for (const p of proposals.slice(1)) {
      const r = await applyProposal(db, failing, await row(p), p, "owner");
      expect(r).toEqual({ ok: false, error: "nope" });
    }
    expect((await db.select().from(adAds)).length).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(adProposals)).some((p) => p.status === "failed")).toBe(true);
  });

  it("switches campaigns on and off, and paces the budget by the rule", async () => {
    const all = await db.select().from(adCampaigns);
    expect(await setCampaignsStatus(db, provider, "enabled")).toBe(all.length);
    expect(await setCampaignsStatus(db, provider, "paused", all[0]!.id)).toBe(1);
    await updateSettings(db, { targetCostCents: 1 });
    const paced = await paceBudgets(db, provider);
    expect(paced.cents).toBeGreaterThan(0);
    await updateSettings(db, { targetCostCents: null });
    await setCampaignsStatus(db, provider, "paused");
  });

  it("a small budget: a campaign that is hardly shown gets a higher price cap, and the campaign's ceiling follows", async () => {
    await updateSettings(db, { dailyBudgetCents: 500, mode: "approve" });
    const all = await db
      .select()
      .from(adCampaigns)
      .where(sql`${adCampaigns.kind} = 'search'`);
    const [starved, shown] = all;
    await setCampaignsStatus(db, provider, "enabled", starved!.id);
    await setCampaignsStatus(db, provider, "enabled", shown!.id);
    const old = new Date(Date.now() - 10 * 86_400_000);
    await db.update(adCampaigns).set({ syncedAt: old });
    await db.update(adGroups).set({ cpcCapCents: 30 });
    await db.delete(adProposals);
    // One campaign was not shown at all in the last week; the other was shown plenty.
    await db.delete(adDailyStats).where(sql`${adDailyStats.entityId} = ${starved!.id}`);
    await db
      .insert(adDailyStats)
      .values({ day: dayOffset(new Date(), 2), level: "campaign", entityId: shown!.id, impressions: 900 })
      .onConflictDoUpdate({
        target: [adDailyStats.day, adDailyStats.level, adDailyStats.entityId],
        set: { impressions: 900 },
      });
    const run = async () =>
      (
        await db
          .insert(adAgentRuns)
          .values({ kind: "test", day: dayOffset(new Date(), 0) })
          .returning()
      )[0]!;
    const groups = await db
      .select()
      .from(adGroups)
      .where(sql`${adGroups.campaignId} = ${starved!.id}`);

    // "Apstiprināt": the raise waits for the owner, nothing changes in Google.
    expect(await raiseStarvedCaps(db, provider, (await run()).id)).toBe(groups.length);
    const waiting = await db.select().from(adProposals);
    expect(waiting.every((p) => p.action === "set_cpc" && p.status === "proposed")).toBe(true);
    expect(waiting.every((p) => (p.params as { cpcCapCents: number }).cpcCapCents === 45)).toBe(true);
    expect(waiting[0]!.reason).toContain(starved!.name);
    expect((await db.select().from(adGroups)).every((g) => g.cpcCapCents === 30)).toBe(true);
    // Not twice within three days.
    await db.delete(adAgentRuns).where(sql`${adAgentRuns.kind} = 'test'`);
    expect(await raiseStarvedCaps(db, provider, (await run()).id)).toBe(0);

    // "Pārvaldīt pašam": applied at once, and the campaign's own ceiling is raised with it.
    await db.delete(adProposals);
    await db.delete(adChanges);
    await db.delete(adAgentRuns).where(sql`${adAgentRuns.kind} = 'test'`);
    await updateSettings(db, { mode: "manage" });
    expect(await raiseStarvedCaps(db, provider, (await run()).id)).toBe(groups.length);
    const after = await db
      .select()
      .from(adGroups)
      .where(sql`${adGroups.campaignId} = ${starved!.id}`);
    expect(after.every((g) => g.cpcCapCents === 45)).toBe(true);
    const others = await db
      .select()
      .from(adGroups)
      .where(sql`${adGroups.campaignId} = ${shown!.id}`);
    expect(others.every((g) => g.cpcCapCents === 30)).toBe(true);
    const sent = (await db.select().from(adChanges)).map((c) => c.operation);
    expect(sent).toContainEqual({ op: "set_cpc_ceiling", campaign: starved!.googleId, cents: 45 });

    // The agent reads the goal, the small-budget limits and what each category's visitors did.
    const context = await optimiserContext(db);
    expect(context.settings).toMatchObject({
      smallBudget: true,
      maxBudgetMoveShare: 0.5,
      cpcCeilingCents: 100,
    });
    expect(context.campaigns[0]).toHaveProperty("emailsFromAds28");
    expect(context.adGroups[0]).toHaveProperty("siteFunnel28");

    // Switching a campaign off: the day's total goes to the ones that stay on.
    const p: Proposal = { action: "pause_campaign", campaignId: shown!.id };
    const [row] = await db
      .insert(adProposals)
      .values({ action: p.action, params: p as unknown as Record<string, unknown>, reason: "r" })
      .returning();
    expect((await applyProposal(db, provider, row!, p, "auto")).ok).toBe(true);
    const now = await db.select().from(adCampaigns);
    expect(now.find((c) => c.id === shown!.id)!.status).toBe("paused");
    const running = now.filter((c) => c.status === "enabled");
    expect(running.reduce((a, c) => a + c.budgetCents, 0)).toBe(500);
    const back: Proposal = { action: "enable_campaign", campaignId: shown!.id };
    const [row2] = await db
      .insert(adProposals)
      .values({ action: back.action, params: back as unknown as Record<string, unknown>, reason: "r" })
      .returning();
    expect((await applyProposal(db, provider, row2!, back, "auto")).ok).toBe(true);
    const again = (await db.select().from(adCampaigns)).filter((c) => c.status === "enabled");
    expect(again.map((c) => c.id)).toContain(shown!.id);
    expect(again.reduce((a, c) => a + c.budgetCents, 0)).toBe(500);

    await db.delete(adAgentRuns).where(sql`${adAgentRuns.kind} = 'test'`);
    await db.delete(adProposals);
    await updateSettings(db, { mode: "approve", dailyBudgetCents: 1500 });
    await setCampaignsStatus(db, provider, "paused");
  });

  it("one budget for Google and Meta: split by e-mails per euro, Meta's budget set, a spent ad paused", async () => {
    const today = dayOffset(new Date(), 0);
    const day = (n: number) => dayOffset(new Date(), n);
    await db.delete(adLandings).where(sql`${adLandings.path} like '/e2e-ads%'`);
    await updateSettings(db, {
      dailyBudgetCents: 500,
      mode: "approve",
      metaManaged: true,
      metaDailyCents: 0,
    });
    const [google] = await db
      .select()
      .from(adCampaigns)
      .where(sql`${adCampaigns.kind} = 'search'`)
      .limit(1);
    await setCampaignsStatus(db, provider, "enabled", google!.id);
    // What the tests after this one rely on is put back at the end.
    const statsBefore = await db.select().from(adDailyStats);
    const campaignsBefore = await db.select().from(adCampaigns);
    // Google spent 20 € in the month without an e-mail.
    await db.delete(adDailyStats);
    await db.insert(adDailyStats).values({
      day: day(3),
      level: "campaign",
      entityId: google!.id,
      costMicros: 20_000_000,
      impressions: 900,
    });
    // Meta: 12 € on two ads; the first ad's visitors left two e-mails, the second none.
    const meta = mockMetaAds({
      insights: [
        {
          day: day(2),
          adId: "9300000001",
          campaignId: "9100000001",
          spendCents: 600,
          impressions: 4000,
          linkClicks: 30,
        },
        {
          day: day(2),
          adId: "9300000002",
          campaignId: "9100000001",
          spendCents: 600,
          impressions: 4000,
          linkClicks: 12,
        },
      ],
    });
    const [buyer] = await db
      .insert(users)
      .values({ email: `marketing-test-${Date.now()}@example.invalid` })
      .returning();
    const visit = async (n: number, ad: string) => {
      const who = { ip: `203.0.113.${n}`, userAgent: "Mozilla/5.0 marketing" };
      await recordAdLanding(db, {
        ...who,
        path: "/e2e-ads/meta-lead",
        params: adParams({
          utm_source: "meta",
          utm_medium: "paid_social",
          utm_campaign: "Trilio Leads",
          utm_content: ad,
        })!,
      });
      return (await adLandingFor(db, who))!;
    };
    for (const n of [21, 22])
      await db.insert(savedItems).values({
        userId: buyer!.id,
        kind: "product",
        key: `marketing-test-${n}`,
        subcategoryId: "fridge",
        adLandingId: await visit(n, "A1 trīs varianti"),
      });
    for (const n of [23, 24, 25, 26]) await visit(n, "A2 pajautā cenu");
    // Other suites write ad visits to the same tables while this runs: only this campaign's rows are read.
    expect((await metaLeads(db, day(28), today)).filter((l) => l.campaign === "trilio leads")).toEqual([
      { campaign: "trilio leads", ad: "a1 trīs varianti", leads: 2 },
    ]);

    // Not in "manage": the split is written down as a suggestion, nothing is changed.
    const suggested = await runMarketingDaily(db, { meta, google: provider });
    expect(suggested).toMatchObject({ ok: true, applied: false, budgets: 0 });
    // Each running channel keeps at least 30 % of the 5 €, and the parts add up.
    expect(suggested!.split!.google + suggested!.split!.meta).toBe(500);
    expect(Math.min(suggested!.split!.google, suggested!.split!.meta)).toBeGreaterThanOrEqual(150);
    expect(meta.calls).toEqual([]);
    expect((await getSettings(db)).metaDailyCents).toBe(0);
    expect(await runMarketingDaily(db, { meta, google: provider })).toBeNull();
    const perf = await channelPerformance(db);
    expect(perf.google).toMatchObject({ active: true, spendCents: 2000 });
    expect(perf.meta).toMatchObject({ active: true, spendCents: 1200 });
    expect(perf.meta.leads).toBeGreaterThanOrEqual(2);
    expect(perf.meta.costPerLeadCents).toBeLessThanOrEqual(600);

    // "Pārvaldīt pašam": the split is applied, Meta's campaign budget set, the spent ad paused.
    await updateSettings(db, { mode: "manage" });
    const done = await runMarketingDaily(db, { meta, google: provider, force: true });
    expect(done).toMatchObject({ ok: true, applied: true, budgets: 1, paused: 1 });
    expect(done!.split!.google + done!.split!.meta).toBe(500);
    const s = await getSettings(db);
    expect(s.metaDailyCents).toBe(done!.split!.meta);
    expect(meta.calls).toEqual([
      { op: "budget", id: "9100000001", value: done!.split!.meta },
      { op: "status", id: "9300000002", value: "PAUSED" },
    ]);
    // Google's campaigns now share what Meta's part leaves.
    const running = (await db.select().from(adCampaigns)).filter((c) => c.status === "enabled");
    expect(running.reduce((a, c) => a + c.budgetCents, 0)).toBe(done!.split!.google);
    const steps = await db.select().from(marketingActions);
    expect(steps.map((a) => a.kind).sort()).toEqual(["meta_budget", "meta_pause", "split"]);
    expect(steps.find((a) => a.kind === "meta_pause")!.reason).toContain("neatnesa nevienu e-pastu");

    // A Meta account that cannot be read: said so, nothing changed.
    const broken = { ...meta, list: async () => ({ ok: false as const, error: "Permissions error [200]" }) };
    expect(await runMarketingDaily(db, { meta: broken, google: provider, force: true })).toMatchObject({
      ok: false,
      error: "Permissions error [200]",
    });
    // Without Meta, or with the one budget switched off, the round does not run.
    expect(await runMarketingDaily(db, { meta: null, google: provider, force: true })).toBeNull();
    await updateSettings(db, {
      metaManaged: false,
      metaDailyCents: 0,
      mode: "approve",
      dailyBudgetCents: 1500,
    });
    expect(await runMarketingDaily(db, { meta, google: provider, force: true })).toBeNull();
    await db.delete(savedItems).where(sql`${savedItems.userId} = ${buyer!.id}`);
    await db.delete(adLandings).where(sql`${adLandings.path} = '/e2e-ads/meta-lead'`);
    await db.delete(adDailyStats);
    for (let i = 0; i < statsBefore.length; i += 2000)
      await db.insert(adDailyStats).values(statsBefore.slice(i, i + 2000));
    for (const c of campaignsBefore)
      await db
        .update(adCampaigns)
        .set({ status: c.status, budgetCents: c.budgetCents })
        .where(sql`${adCampaigns.id} = ${c.id}`);
  });

  it("the agent makes its own Meta ads, replaces one whose price changed, and rests a category that brought nothing", async () => {
    const campaignsBefore = await db.select().from(adCampaigns);
    // Neither channel has spent anything yet: the day starts even.
    const statsBefore = await db.select().from(adDailyStats);
    await db.delete(adDailyStats);
    await db.delete(marketingActions);
    await db.delete(metaAgentAds);
    await db.delete(metaAdEntities);
    await updateSettings(db, { dailyBudgetCents: 500, mode: "manage", metaManaged: true, metaDailyCents: 0 });
    const [google] = await db
      .select()
      .from(adCampaigns)
      .where(sql`${adCampaigns.kind} = 'search'`)
      .limit(1);
    await setCampaignsStatus(db, provider, "enabled", google!.id);
    // An empty Meta account: no campaign yet.
    const meta = mockMetaAds({ entities: [] });
    const config: CreatorConfig = {
      pageId: "100200300",
      instagramUserId: "17840000000000000",
      pixelId: "2161476984461393",
      advertiser: "Sky Solutions SIA",
      dsa: null,
      baseUrl: "https://trilio.test",
      domain: "trilio.test",
    };
    const prices: Record<string, number> = { fridge: 49900, vacuum: 19900, hob: 29900 };
    let noPhoto = false;
    const picks = async (sub: string): Promise<PostFacts | null> =>
      prices[sub] === undefined
        ? null
        : {
            kind: "picks",
            subcategoryId: sub,
            category: sub === "fridge" ? "Ledusskapji" : sub === "vacuum" ? "Putekļsūcēji" : "Plīts virsmas",
            questions: [],
            picks: [0, 1, 2].map((i) => ({
              name: `Modelis ${sub.toUpperCase()}${i}`,
              priceCents: prices[sub]! + i * 5000,
              shop: "Veikals A",
              // A category whose picks lack a photo gets no ad: the ad is its products' pictures.
              imageUrl: sub === "hob" && noPhoto ? null : "/sample/kettle-black.png",
            })),
            path: `/izvelies/x/${sub}`,
          };
    const render: AdRenderer = {
      missingPhoto: async (f) => f.picks.find((p) => !p.imageUrl)?.name ?? null,
      picture: async () => Buffer.from("jpeg-bytes"),
      reel: async () => Buffer.from("mp4-bytes"),
    };
    const creator = {
      config,
      render,
      load: {
        funnel: async () => [
          { subcategoryId: "hob", resultsVisitors: 37, sent: 0, taps: 0 },
          { subcategoryId: "fridge", resultsVisitors: 53, sent: 2, taps: 10 },
          { subcategoryId: "vacuum", resultsVisitors: 15, sent: 3, taps: 6 },
          { subcategoryId: "toaster", resultsVisitors: 90, sent: 9, taps: 30 },
        ],
        picks,
      },
    };
    const today = dayOffset(new Date(), 0).replace(/-/g, "");

    // Day one: Meta has nothing, so the agent makes the campaign, the ad set and, for each of
    // the two categories whose visitors leave e-mails (one per euro of Meta's 2,50 €), four ads:
    // two pictures, a carousel and a Reel. A category that cannot show three picks gets none.
    const formats = ["a", "b", "karusele", "reel"];
    expect(await ensureAgentAds(db, { meta, ...creator }, 250)).toEqual({
      created: 8,
      retired: 0,
      failed: 0,
    });
    expect(meta.calls.map((c) => c.op)).toEqual(["campaign", "adset", ...Array(8).fill("ad")]);
    expect(meta.calls.map((c) => c.value)).toEqual([
      "trilio-ai-epasti",
      "latvija",
      ...formats.map((f) => `vacuum-${f}-${today}`),
      ...formats.map((f) => `fridge-${f}-${today}`),
    ]);
    const made = await db.select().from(metaAgentAds);
    expect(made.map((a) => a.status)).toEqual(Array(8).fill("active"));
    expect(made.filter((a) => a.subcategoryId === "fridge").map((a) => a.format)).toEqual([
      "collage",
      "collage_b",
      "carousel",
      "reel",
    ]);
    const fridgeAd = made.find((a) => a.subcategoryId === "fridge" && a.format === "collage")!;
    expect(fridgeAd.link).toBe(
      `https://trilio.test/rezultati?sub=fridge&cena=tipiska&utm_source=meta&utm_medium=paid_social&utm_campaign=trilio-ai-epasti&utm_content=fridge-a-${today}`,
    );
    expect(fridgeAd.message).toMatch(/• Modelis FRIDGE0: 499\s€/);
    expect(fridgeAd.imageHash).toBe("hash10");
    // What Meta was sent: pictures shaped per placement (a creative of their own), the three
    // products as carousel cards, and the Reel with its thumbnail.
    const sent = (ad: string) => meta.creatives.find((c) => c.ad === ad)!.creative;
    expect(sent(`fridge-a-${today}`)).toEqual({ creative_id: expect.stringMatching(/^cr\d+$/) });
    const placed = meta.creatives.find(
      (c) => (c.creative as { name?: string }).name === `fridge-a-${today}`,
    )!;
    expect(Object.keys(placed.creative)).toEqual(["name", "object_story_spec", "asset_feed_spec"]);
    const carousel = sent(`fridge-karusele-${today}`) as {
      object_story_spec: { link_data: { child_attachments: { name: string; description: string }[] } };
    };
    expect(carousel.object_story_spec.link_data.child_attachments.map((c) => c.name)).toEqual([
      "Modelis FRIDGE0",
      "Modelis FRIDGE1",
      "Modelis FRIDGE2",
    ]);
    expect(carousel.object_story_spec.link_data.child_attachments[0]!.description).toMatch(
      /499\s€ · Veikals A/,
    );
    const reel = sent(`fridge-reel-${today}`) as { object_story_spec: { video_data: { video_id: string } } };
    expect(reel.object_story_spec.video_data.video_id).toBe(String(9500000000 + "mp4-bytes".length));
    const steps = await db.select().from(marketingActions);
    expect(steps.filter((a) => a.kind === "meta_create" && a.applied)).toHaveLength(10);
    expect(steps.some((a) => a.reason.includes("(karusele)"))).toBe(true);

    // Nothing changed: the same ads stay, nothing new is made.
    meta.calls.length = 0;
    expect(await ensureAgentAds(db, { meta, ...creator }, 250)).toEqual({
      created: 0,
      retired: 0,
      failed: 0,
    });
    expect(meta.calls).toEqual([]);

    // A fridge got cheaper: every fridge ad quotes the old price, so all four are paused and new
    // ones replace them (the next morning: today's eight new ads are the day's limit).
    const tomorrow = new Date(Date.now() + 86_400_000);
    prices.fridge = 47900;
    expect(await ensureAgentAds(db, { meta, ...creator }, 250)).toEqual({
      created: 0,
      retired: 4,
      failed: 0,
    });
    expect(await ensureAgentAds(db, { meta, ...creator, now: tomorrow }, 250)).toEqual({
      created: 4,
      retired: 0,
      failed: 0,
    });
    const fridgeAds = (await db.select().from(metaAgentAds)).filter((a) => a.subcategoryId === "fridge");
    expect(fridgeAds.filter((a) => a.status === "paused").map((a) => a.retiredWhy)).toEqual(
      Array(4).fill("facts"),
    );
    expect(fridgeAds.filter((a) => a.status === "active").every((a) => /479\s€/.test(a.message))).toBe(true);

    // The vacuum ads were stopped for bringing nothing: the category rests, the next one gets the place.
    await db
      .update(metaAgentAds)
      .set({ status: "paused", retiredAt: new Date(), retiredWhy: "no_leads" })
      .where(sql`${metaAgentAds.subcategoryId} = 'vacuum'`);
    meta.calls.length = 0;
    expect(await ensureAgentAds(db, { meta, ...creator, now: tomorrow }, 250)).toEqual({
      created: 4,
      retired: 0,
      failed: 0,
    });
    expect(meta.calls.map((c) => String(c.value).split("-")[0])).toEqual(Array(4).fill("hob"));

    // A refusal by Meta is written down with Meta's words, and nothing is recorded as made.
    await db.delete(metaAgentAds);
    const refusing = {
      ...meta,
      createAd: async () => ({ ok: false as const, error: "Budget too low [100]" }),
    };
    expect(await ensureAgentAds(db, { meta: refusing, ...creator }, 100)).toMatchObject({
      created: 0,
      failed: 4,
    });
    expect(await db.select().from(metaAgentAds)).toEqual([]);
    const refused = (await db.select().from(marketingActions)).find(
      (a) => a.error === "Budget too low [100]",
    );
    expect(refused).toMatchObject({ kind: "meta_create", applied: false });
    // Without its products' photos a category is not advertised.
    noPhoto = true;
    await db.delete(metaAgentAds);
    meta.calls.length = 0;
    expect(await ensureAgentAds(db, { meta, ...creator, now: tomorrow }, 300)).toMatchObject({ created: 8 });
    expect(meta.calls.map((c) => String(c.value).split("-")[0])).toEqual([
      ...Array(4).fill("vacuum"),
      ...Array(4).fill("fridge"),
    ]);
    noPhoto = false;
    await db.delete(metaAgentAds);
    // An ad drawn in an older look (the dark list of 26 Nov 2026, the square-only collage of
    // 27 Nov) is replaced, its category not rested: the prices still hold, only the picture changes.
    expect(await ensureAgentAds(db, { meta, ...creator }, 250)).toMatchObject({ created: 8 });
    const oldLook = (await db.select().from(metaAgentAds)).find(
      (a) => a.subcategoryId === "vacuum" && a.format === "collage",
    )!;
    const { look: _look, ...drawnBefore } = oldLook.facts;
    void _look;
    await db
      .update(metaAgentAds)
      .set({ facts: drawnBefore })
      .where(sql`${metaAgentAds.id} = ${oldLook.id}`);
    meta.calls.length = 0;
    expect(await ensureAgentAds(db, { meta, ...creator, now: tomorrow }, 250)).toEqual({
      created: 1,
      retired: 1,
      failed: 0,
    });
    expect(meta.calls.map((c) => c.op)).toEqual(["status", "ad"]);
    expect(
      (await db.select().from(marketingActions)).some((a) => a.reason.includes("jauno noformējumu")),
    ).toBe(true);
    // Meta refuses pictures shaped per placement: the square picture goes everywhere and the
    // refusal is written down. Without ffmpeg there is no Reel, and that is said once a week.
    await db.delete(metaAgentAds);
    const noShapes = {
      ...meta,
      createCreative: async () => ({
        ok: false as const,
        error: "Placement customization not supported [100]",
      }),
    };
    const noFfmpeg = { ...creator, render: { ...render, reel: async () => null } };
    expect(await ensureAgentAds(db, { meta: noShapes, ...noFfmpeg }, 100)).toEqual({
      created: 3,
      retired: 0,
      failed: 0,
    });
    const square = meta.creatives.at(-3)!.creative as {
      object_story_spec: { link_data: { image_hash: string } };
    };
    expect(square.object_story_spec.link_data.image_hash).toBe("hash10");
    expect(await ensureAgentAds(db, { meta: noShapes, ...noFfmpeg }, 100)).toEqual({
      created: 0,
      retired: 0,
      failed: 0,
    });
    const log = await db.select().from(marketingActions);
    expect(log.filter((a) => a.error === "Placement customization not supported [100]")).toHaveLength(2);
    expect(log.filter((a) => a.reason.startsWith("Reel video netiek veidots"))).toHaveLength(1);
    await db.delete(metaAgentAds);
    // No share, no ad.
    expect(await ensureAgentAds(db, { meta, ...creator }, 50)).toEqual({ created: 0, retired: 0, failed: 0 });
    // The daily round runs the same thing with Meta's share of the day, and a channel the
    // agent can make ads for counts as running.
    const round = await runMarketingDaily(db, { meta, google: provider, creator, force: true });
    expect(round).toMatchObject({ ok: true, applied: true });
    expect(round!.split!.google + round!.split!.meta).toBe(500);
    expect(round!.split!.meta).toBeGreaterThanOrEqual(150);

    await db.delete(marketingActions);
    await db.delete(metaAgentAds);
    await db.delete(metaAdEntities);
    for (let i = 0; i < statsBefore.length; i += 2000)
      await db.insert(adDailyStats).values(statsBefore.slice(i, i + 2000));
    await updateSettings(db, {
      metaManaged: false,
      metaDailyCents: 0,
      mode: "approve",
      dailyBudgetCents: 1500,
    });
    for (const c of campaignsBefore)
      await db
        .update(adCampaigns)
        .set({ status: c.status, budgetCents: c.budgetCents })
        .where(sql`${adCampaigns.id} = ${c.id}`);
  });

  it("the SEO agent rewrites the title of a page that is seen and not clicked, and takes back what lost clicks", async () => {
    const before = await db.select().from(seoQueries);
    await db.delete(seoQueries);
    await db.delete(seoOverrides);
    await db.delete(adAgentRuns).where(sql`${adAgentRuns.kind} = 'seo'`);
    const now = new Date();
    const day = (n: number) => dayOffset(now, n);
    // The fridge page: shown 400 times at position 8, clicked 4 times (an ordinary result gets 10).
    // The washer page is clicked plenty; the home page is not a category page.
    await db.insert(seoQueries).values([
      {
        day: day(3),
        query: "ledusskapis ar saldētavu",
        page: "/kategorija/fridge",
        impressions: 300,
        clicks: 3,
        position: 8,
      },
      {
        day: day(5),
        query: "labākais ledusskapis",
        page: "/kategorija/fridge",
        impressions: 100,
        clicks: 1,
        position: 8,
      },
      {
        day: day(3),
        query: "veļas mašīna",
        page: "/kategorija/washer",
        impressions: 200,
        clicks: 20,
        position: 6,
      },
      { day: day(3), query: "trilio", page: "/", impressions: 900, clicks: 5, position: 9 },
    ]);
    const fridge = (await pageSearch(db, day(28))).find((p) => p.path === "/kategorija/fridge")!;
    expect(fridge).toMatchObject({ impressions: 400, clicks: 4, position: 8 });
    expect(fridge.queries[0]!.query).toBe("ledusskapis ar saldētavu");

    const year = now.getFullYear();
    const template = landingTemplateMeta("/kategorija/fridge", year)!;
    expect(template.title).toBe(`Labākie ledusskapji ${year}: cenas un salīdzinājums`);
    expect(landingTemplateMeta("/kategorija/fridge/lidz-800", year)!.title).toMatch(
      /^Labākie ledusskapji līdz 800\s€/,
    );
    expect(landingTemplateMeta("/rezultati", year)).toBeNull();

    const good = {
      title: `Ledusskapji ar saldētavu ${year}: 3 piemērotākie`,
      description:
        "Trīs piemērotākie ledusskapji ar saldētavu partneru veikalos ar šodienas cenām. Atbildi uz dažiem jautājumiem vai pajautā zemāku cenu.",
      why: "Atbild uz meklējumu “ledusskapis ar saldētavu”.",
    };
    let answer: typeof good = good;
    const asked: string[] = [];
    const caller: StructuredCaller = async (req) => {
      asked.push(req.user);
      return (req.schema as unknown) === SeoCopy
        ? { ok: true, value: req.schema.parse(answer), usage: { inputTokens: 1, outputTokens: 1 } }
        : { ok: false, reason: "disabled" };
    };
    const current = async (path: string) => landingTemplateMeta(path, year);

    // Not in "manage": the text waits as a proposal and the page keeps its own title.
    expect(await runSeoAgent(db, { caller, apply: false, current, now })).toMatchObject({
      ok: true,
      written: 1,
      applied: 0,
      refused: 0,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("ledusskapis ar saldētavu");
    expect(asked[0]).toContain("Labākie ledusskapji");
    const [proposal] = await db.select().from(seoOverrides);
    expect(proposal).toMatchObject({
      path: "/kategorija/fridge",
      status: "proposed",
      query: "ledusskapis ar saldētavu",
      before: { impressions: 400, clicks: 4, position: 8 },
    });
    expect(await seoOverrideFor(db, "/kategorija/fridge")).toBeNull();
    // A page with a proposal waiting is not written for again.
    expect(await runSeoAgent(db, { caller, apply: false, current, now })).toMatchObject({ written: 0 });
    // The owner approves: it is the page's title now. Refusing a live one is not a thing; taking it back is.
    expect(await decideSeoOverride(db, proposal!.id, "approve", now)).toBe(true);
    expect(await decideSeoOverride(db, proposal!.id, "reject", now)).toBe(false);
    expect(await seoOverrideFor(db, "/kategorija/fridge")).toMatchObject({ title: good.title });
    expect(await decideSeoOverride(db, "00000000-0000-4000-8000-000000000000", "approve")).toBe(false);

    // Three weeks on, people click it less than before: the change is taken back.
    const later = new Date(now.getTime() + 22 * 86_400_000);
    expect(await judgeTrials(db, now)).toEqual({ kept: 0, reverted: 0 });
    await db.insert(seoQueries).values({
      day: dayOffset(later, 2),
      query: "ledusskapis ar saldētavu",
      page: "/kategorija/fridge",
      impressions: 300,
      clicks: 1,
      position: 8,
    });
    expect(await judgeTrials(db, later)).toEqual({ kept: 0, reverted: 1 });
    expect(await seoOverrideFor(db, "/kategorija/fridge")).toBeNull();
    expect((await db.select().from(seoOverrides))[0]).toMatchObject({
      status: "reverted",
      after: { impressions: 300, clicks: 1 },
    });

    // "Pārvaldīt pašam": a checked text goes live at once; a dishonest one never does.
    await db.delete(seoOverrides);
    await db.delete(seoQueries).where(sql`${seoQueries.day} > ${day(0)}`);
    answer = { ...good, title: "Lētākie ledusskapji Latvijā" };
    expect(await runSeoAgent(db, { caller, apply: true, current, now })).toMatchObject({
      written: 1,
      applied: 0,
      refused: 1,
    });
    expect(await db.select().from(seoOverrides)).toEqual([]);
    answer = good;
    await updateSettings(db, { mode: "manage" });
    expect(await runSeoJob(db, { force: true, caller, now })).toMatchObject({ written: 1, applied: 1 });
    const live = await seoOverrideFor(db, "/kategorija/fridge");
    expect(live).toMatchObject({ status: "active", title: good.title });
    // The owner can take a live one back by hand, and a kept one stays the page's text.
    expect(await decideSeoOverride(db, live!.id, "revert")).toBe(true);
    expect(await seoOverrideFor(db, "/kategorija/fridge")).toBeNull();
    // Held on a Tuesday before the hour, the weekly job does not run by itself.
    expect(await runSeoJob(db, { caller, now: new Date("2026-11-24T03:00:00Z") })).toBeNull();
    // A failing model changes nothing and says so.
    await db.delete(seoOverrides);
    const down: StructuredCaller = async () => ({ ok: false, reason: "error" });
    expect(await runSeoAgent(db, { caller: down, apply: true, current, now })).toMatchObject({
      ok: false,
      written: 0,
    });

    await updateSettings(db, { mode: "approve" });
    await db.delete(seoOverrides);
    await db.delete(seoQueries);
    for (let i = 0; i < before.length; i += 2000)
      await db.insert(seoQueries).values(before.slice(i, i + 2000));
  });

  it("applies the recommendation: suggested budgets, the recommended campaigns on, the rest untouched", async () => {
    await setCampaignsStatus(db, provider, "paused");
    await updateSettings(db, { dailyBudgetCents: 500 });
    const before = await campaignPriorities(db);
    const now = before.recommendations.filter((r) => r.tier === "now");
    // 5 € a day feeds the brand campaign (1 €) and two categories (2 € each).
    expect(now.map((r) => r.budgetCents)).toEqual([100, 200, 200]);
    expect(now[0]!.reason).toBe("brand");
    expect(before.recommendations.find((r) => r.facts.kind === "pmax")?.tier ?? "wait").toBe("wait");

    // One campaign from its own button, then the rest.
    expect(await applyRecommendation(db, provider, now[1]!.id)).toEqual({ enabled: 1, skipped: 0 });
    expect(await applyRecommendation(db, provider)).toEqual({ enabled: 3, skipped: 0 });
    const rows = await db.select().from(adCampaigns);
    const on = rows.filter((c) => c.status === "enabled");
    expect(on.map((c) => c.id).sort()).toEqual(now.map((r) => r.id).sort());
    expect(on.reduce((n, c) => n + c.budgetCents, 0)).toBe(500);

    // A budget set by hand reaches Google and the record; a paused campaign takes no share of pacing.
    const paused = rows.find((c) => c.status === "paused" && c.kind === "search")!;
    expect(await setCampaignBudget(db, provider, paused.id, 300)).toEqual({ ok: true });
    await paceBudgets(db, provider);
    const after = await db.select().from(adCampaigns);
    expect(after.find((c) => c.id === paused.id)!.budgetCents).toBe(300);
    expect(await setCampaignBudget(db, provider, "00000000-0000-0000-0000-000000000000", 300)).toEqual({
      ok: false,
      error: "not_found",
    });

    // The best-practice settings go to each synced Search campaign once.
    const first = await tuneSearchCampaigns(db, provider);
    expect(first.failed).toBe(0);
    expect(first.tuned).toBe(after.filter((c) => c.kind === "search" && c.googleId).length);
    expect(await tuneSearchCampaigns(db, provider)).toEqual({ tuned: 0, failed: 0 });
    const sent = await db
      .select()
      .from(adChanges)
      .where(sql`${adChanges.operation}->>'op' = 'tune_search'`);
    const cool = sent.find((c) => JSON.stringify(c.operation).includes("/kategorija/fridge"));
    expect(JSON.stringify(cool?.operation)).toContain('"text":"Ledusskapji"');
    await setCampaignsStatus(db, provider, "paused");
  });

  it("writes Claude's copy only when it is honest, and builds PMax from approved images", async () => {
    const reply = (headline: string, onScreen = "Dažas atbildes") =>
      (async (req) => ({
        ok: true,
        value: req.schema.parse({
          headline,
          body: "Atbildi uz dažiem jautājumiem.",
          video: [1, 2, 3].map((i) => ({ seconds: 3, onScreen: `${onScreen} ${i}`, visual: "Kadrs" })),
        }),
        usage: { inputTokens: 1, outputTokens: 1 },
      })) as StructuredCaller;
    expect((await writeCopy(db, reply("Ledusskapji bez minēšanas"), "fridge")).headline).toBe(
      "Ledusskapji bez minēšanas",
    );
    expect((await writeCopy(db, reply("Lētākie ledusskapji tikai šodien!"), "fridge")).headline).toBe(
      templateCopy("fridge").headline,
    );
    expect((await writeCopy(db, null, "fridge")).headline).toBe(templateCopy("fridge").headline);
    expect((await writeCopy(db, async () => ({ ok: false, reason: "disabled" }), "fridge")).headline).toBe(
      templateCopy("fridge").headline,
    );

    const fridgeGroup = (await db.select().from(adCampaigns)).find(
      (c) => c.groupId && c.groupId !== "competitors" && c.groupId !== "brand",
    )!;
    expect((await createPmax(db, provider, "competitors", 500)).ok).toBe(false);
    expect((await createPmax(db, provider, "brand", 500)).ok).toBe(false);
    expect((await createPmax(db, provider, "no-such-group", 500)).ok).toBe(false);
    expect((await createPmax(db, provider, fridgeGroup.groupId!, 500)).error).toMatch(/approve/);

    const rows = await db
      .select()
      .from(adCreatives)
      .where(sql`${adCreatives.subcategoryId} = 'fridge'`);
    const failing: AdsProvider = { ...provider, apply: async () => ({ ok: false, error: "nope" }) };
    const image = rows.find((r) => r.kind === "image")!;
    expect(await approveCreative(db, failing, image)).toEqual({ ok: false, error: "nope" });
    for (const r of rows) expect((await approveCreative(db, provider, r)).ok).toBe(true);
    const after = await db
      .select()
      .from(adCreatives)
      .where(sql`${adCreatives.subcategoryId} = 'fridge'`);
    expect(after.filter((r) => r.status === "uploaded")).toHaveLength(3);
    expect(after.find((r) => r.kind === "video_script")!.status).toBe("approved");
    const groupOfFridge = (await db.select().from(adGroups)).find((g) => g.subcategoryId === "fridge")!;
    const [camp] = await db
      .select()
      .from(adCampaigns)
      .where(sql`${adCampaigns.id} = ${groupOfFridge.campaignId}`);
    expect((await createPmax(db, failing, camp!.groupId!, 500)).ok).toBe(false);
    expect(await createPmax(db, provider, camp!.groupId!, 500)).toEqual({ ok: true });
  });

  it("links a later action of the same visitor the same day, and forgets after 90 days", async () => {
    const who = { ip: "203.0.113.7", userAgent: "Mozilla/5.0 test" };
    const params = adParams({
      gclid: "test-click-1234",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "fridge",
    })!;
    await recordAdLanding(db, { ...who, path: "/e2e-ads/landing", params });
    expect(await adLandingFor(db, who)).not.toBeNull();
    expect(await adLandingFor(db, { ...who, ip: "198.51.100.1" })).toBeNull();
    const later = new Date(Date.now() + 91 * 86_400_000);
    expect(await purgeAdLandings(db, later)).toBeGreaterThanOrEqual(1);
  });

  it("keys ad visits by source and campaign: a bare Google click id counts as Google, Meta stays apart", async () => {
    const who = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 test" };
    await recordAdLanding(db, {
      ...who,
      path: "/e2e-ads/gclid-only",
      params: adParams({ gclid: "test-click-5678" })!,
    });
    await recordAdLanding(db, {
      ...who,
      path: "/e2e-ads/suffix",
      params: adParams({
        gclid: "test-click-9012",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "23001",
      })!,
    });
    await recordAdLanding(db, {
      ...who,
      path: "/e2e-ads/meta",
      params: adParams({
        utm_source: "meta",
        utm_medium: "paid_social",
        utm_campaign: "120250227220820296",
      })!,
    });
    const today = dayOffset(new Date(), 0);
    const rows = await conversionsByDay(db, today, today);
    const has = (source: string, campaign: string | null) =>
      rows.some((r) => r.source === source && r.campaign === campaign && r.visits > 0);
    expect(has("google", null)).toBe(true);
    expect(has("google", "23001")).toBe(true);
    expect(has("meta", "120250227220820296")).toBe(true);
  });

  it("finds where the Google account differs from Trilio's record and puts it back", async () => {
    // An account that starts as Trilio set it and remembers what is changed in it.
    const account = new Map<string, CampaignState>();
    const sent: AdsChange[] = [];
    let broken = false;
    const p: AdsProvider = {
      ...provider,
      async inspect(known: Expected[]) {
        if (broken) throw new Error("google ads 500");
        for (const e of known)
          if (!account.has(e.resource))
            account.set(e.resource, {
              resource: e.resource,
              name: e.name,
              status: e.status,
              kind: e.kind,
              bidding: e.kind === "search" ? "maximize_clicks" : "maximize_conversions",
              portfolio: false,
              budget: e.budget ?? "",
              budgetCents: e.budgetCents,
              sharedBudget: false,
              cpcCapCents: e.kind === "search" ? e.cpcCapCents : null,
            });
        return [...account.values()];
      },
      async apply(change) {
        sent.push(change);
        if (change.op === "restore_search") {
          const g = account.get(change.campaign)!;
          const budget = `test/budget/${sent.length}`;
          account.set(change.campaign, {
            ...g,
            bidding: "maximize_clicks",
            portfolio: false,
            sharedBudget: false,
            budget,
            budgetCents: change.budgetCents,
            cpcCapCents: change.cpcCapCents,
          });
          return { ok: true, id: change.campaign, budget };
        }
        if (change.op === "set_budget") {
          for (const [k, g] of account)
            if (g.budget === change.budget) account.set(k, { ...g, budgetCents: change.cents });
          return { ok: true, id: change.budget };
        }
        if (change.op === "set_campaign_status") {
          account.set(change.campaign, { ...account.get(change.campaign)!, status: change.status });
          return { ok: true, id: change.campaign };
        }
        return provider.apply(change);
      },
    };

    const first = await checkAccount(db, p);
    expect(first.ok && first.drift.campaigns).toEqual([]);
    expect(first.ok && first.drift.matching).toBeGreaterThan(1);

    // Someone moves one campaign to a shared budget with conversion bidding, switches another
    // on with a different budget, and creates a campaign of their own.
    const search = await db
      .select()
      .from(adCampaigns)
      .where(sql`${adCampaigns.kind} = 'search'`);
    const [a, b] = search.filter((c) => c.googleId && c.budgetGoogleId);
    await db
      .update(adCampaigns)
      .set({ status: "paused" })
      .where(sql`${adCampaigns.id} = ${b!.id}`);
    account.set(a!.googleId!, {
      ...account.get(a!.googleId!)!,
      bidding: "maximize_conversions",
      portfolio: true,
      sharedBudget: true,
      budget: "test/budget/shared",
      budgetCents: 500,
      cpcCapCents: null,
    });
    account.set(b!.googleId!, {
      ...account.get(b!.googleId!)!,
      status: "enabled",
      budgetCents: b!.budgetCents + 77,
    });
    account.set("test/campaigns/foreign", {
      resource: "test/campaigns/foreign",
      name: "Zīmols — ne Trilio",
      status: "enabled",
      kind: "search",
      bidding: "target_impression_share",
      portfolio: false,
      budget: "test/budget/foreign",
      budgetCents: 500,
      sharedBudget: false,
      cpcCapCents: null,
    });

    const second = await checkAccount(db, p);
    if (!second.ok) throw new Error("check failed");
    const kinds = (id: string) => second.drift.campaigns.find((c) => c.id === id)?.issues.map((i) => i.kind);
    expect(kinds(a!.id)).toEqual(["shared_budget", "bidding"]);
    expect(kinds(b!.id)).toEqual(["status", "budget"]);
    expect(second.drift.foreign.map((f) => f.name)).toEqual(["Zīmols — ne Trilio"]);
    expect((await accountControl(db))?.drift.campaigns).toHaveLength(2);
    // Only the latest check is kept.
    expect(await db.select().from(adAccountChecks)).toHaveLength(1);

    // A failed read changes nothing and keeps the last check.
    broken = true;
    expect(await reconcileAccount(db, p)).toEqual({ ok: false, error: "google ads 500" });
    expect((await accountControl(db))?.drift.campaigns).toHaveLength(2);
    broken = false;

    sent.length = 0;
    expect(await reconcileAccount(db, p)).toEqual({ ok: true, fixed: 2, failed: 0, left: 0 });
    expect(sent.map((c) => c.op)).toEqual(["restore_search", "set_budget", "set_campaign_status"]);
    expect(sent[0]).toMatchObject({ campaign: a!.googleId, budgetCents: a!.budgetCents, cpcCapCents: 30 });
    expect(sent[2]).toMatchObject({ campaign: b!.googleId, status: "paused" });
    // Trilio now knows the campaign's own new budget, so later budget edits reach it.
    const [after] = await db
      .select()
      .from(adCampaigns)
      .where(sql`${adCampaigns.id} = ${a!.id}`);
    expect(after!.budgetGoogleId).toBe(account.get(a!.googleId!)!.budget);
    expect(after!.budgetGoogleId).not.toBe("test/budget/shared");

    // A foreign campaign is paused only if the last check listed it as running.
    expect(await pauseForeignCampaign(db, p, a!.googleId!)).toEqual({ ok: false, error: "not_found" });
    expect(await pauseForeignCampaign(db, p, "test/campaigns/foreign")).toEqual({ ok: true });
    expect(account.get("test/campaigns/foreign")!.status).toBe("paused");
    expect((await accountControl(db))?.drift.foreign[0]?.status).toBe("paused");
  });
});
