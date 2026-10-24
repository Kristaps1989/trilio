import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import {
  adAgentRuns,
  adCampaigns,
  adChanges,
  adCreatives,
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
import { buildCampaigns, getSettings, syncAccount, updateSettings } from "./account";
import { createCreatives, templateCopy } from "./creatives";
import { mockProvider } from "./mock";
import { decideProposal, OptimiserOutput, runDaily } from "./optimiser";

// The ads pipeline end to end against the database (docs/GROWTH_PLAN.md):
// build → sync → daily run with a fake Claude → guardrails → owner's decision.

const url = process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

async function wipe(db: Db) {
  for (const t of [
    adChanges,
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
