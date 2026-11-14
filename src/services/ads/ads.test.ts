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
  seoQueries,
} from "@/db/schema";
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
import { decideProposal, EMPTY_PROPOSAL_FIELDS, OptimiserOutput, runDaily } from "./optimiser";

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
  ])
    await db.delete(t);
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
    const r = await refreshAds(db, provider);
    expect(r).toEqual({ created: before.length, paused: before.length, failed: 0 });
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
