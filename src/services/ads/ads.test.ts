import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import {
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
  getSettings,
  ACCOUNT_ENTITY,
  paceBudgets,
  setCampaignsStatus,
  syncReports,
  syncAccount,
  updateSettings,
  dayOffset,
} from "./account";
import { adsOverview } from "./overview";
import { approveCreative, createCreatives, createPmax, templateCopy, writeCopy } from "./creatives";
import type { AdsProvider } from "./provider";
import type { Proposal } from "@/domain/ads/guardrails";
import { mockProvider } from "./mock";
import { decideProposal, OptimiserOutput, runDaily } from "./optimiser";

// The ads pipeline end to end against the database (docs/GROWTH_PLAN.md):
// build → sync → daily run with a fake Claude → guardrails → owner's decision.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

async function wipe(db: Db) {
  for (const t of [
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
    expect(built.campaigns).toBe(10);
    expect(built.adGroups).toBe(40);
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
              action: "set_cpc",
              adGroupId: g.id,
              cpcCapCents: 35,
              reason: "r",
              expectedEffect: "e",
              confidence: 70,
            },
            {
              action: "new_ad",
              adGroupId: g.id,
              headlines: ["Tikai šodien", "B variants", "C variants"],
              descriptions: ["x", "y"],
              reason: "r",
              expectedEffect: "e",
              confidence: 30,
            },
            {
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
    const tuesday = new Date("2026-10-27T08:00:00Z");
    expect(await runDaily(db, { provider, caller, now: tuesday })).toMatchObject({
      ok: true,
      reviewed: false,
    });
    expect(calls).toEqual([]);
    const [tue] = await db
      .select()
      .from(adAgentRuns)
      .where(sql`${adAgentRuns.day} = '2026-10-27'`);
    expect(tue!.summary).toMatch(/Claude pārskats 2026-11-02/);
    const monday = new Date("2026-11-02T08:00:00Z");
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
      (c) => c.groupId && c.groupId !== "competitors",
    )!;
    expect((await createPmax(db, provider, "competitors", 500)).ok).toBe(false);
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
});
