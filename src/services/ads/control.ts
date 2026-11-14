import { and, desc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { adAccountChecks, adCampaigns, adGroups } from "@/db/schema";
import { accountDrift, fixable, type CampaignState, type Drift, type Expected } from "@/domain/ads/drift";
import { send } from "./account";
import type { AdsProvider } from "./provider";

// Account control (docs/GROWTH_PLAN.md): Trilio's record is the plan, Google Ads
// is what actually runs. This reads the account, stores what it found, and puts
// Trilio's campaigns back on Trilio's settings when the owner asks.

/** The click-price cap Trilio set at creation; an ad group may have been given a higher one since. */
const DEFAULT_CPC_CAP_CENTS = 30;

/** Every synced campaign as Trilio set it. */
export async function expectedCampaigns(db: Db): Promise<Expected[]> {
  const rows = await db
    .select()
    .from(adCampaigns)
    .where(and(isNotNull(adCampaigns.googleId), inArray(adCampaigns.status, ["enabled", "paused"])));
  const caps = await db
    .select({ id: adGroups.campaignId, cap: sql<number>`max(${adGroups.cpcCapCents})::int` })
    .from(adGroups)
    .where(ne(adGroups.status, "removed"))
    .groupBy(adGroups.campaignId);
  const cap = new Map(caps.map((c) => [c.id, c.cap]));
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    resource: c.googleId!,
    kind: c.kind,
    status: c.status === "enabled" ? "enabled" : "paused",
    budget: c.budgetGoogleId,
    budgetCents: c.budgetCents,
    cpcCapCents: Math.max(DEFAULT_CPC_CAP_CENTS, cap.get(c.id) ?? 0),
  }));
}

/** Reads the account from the platform and stores it. Fails without storing if the platform does. */
export async function checkAccount(
  db: Db,
  provider: AdsProvider,
  now = new Date(),
): Promise<{ ok: true; drift: Drift } | { ok: false; error: string }> {
  const expected = await expectedCampaigns(db);
  let campaigns: CampaignState[];
  try {
    campaigns = await provider.inspect(expected);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const [row] = await db.insert(adAccountChecks).values({ campaigns, checkedAt: now }).returning();
  await db.delete(adAccountChecks).where(lt(adAccountChecks.checkedAt, row!.checkedAt));
  return { ok: true, drift: accountDrift(expected, campaigns) };
}

export type AccountControl = { checkedAt: Date; drift: Drift; google: CampaignState[] } | null;

/** The last check against Trilio's record as it is now. Null: never checked. */
export async function accountControl(db: Db): Promise<AccountControl> {
  const [last] = await db.select().from(adAccountChecks).orderBy(desc(adAccountChecks.checkedAt)).limit(1);
  if (!last) return null;
  return {
    checkedAt: last.checkedAt,
    drift: accountDrift(await expectedCampaigns(db), last.campaigns),
    google: last.campaigns,
  };
}

/**
 * Puts Trilio's campaigns back on Trilio's settings: own budget and click bidding for Search,
 * the budget amount and the on/off state for all. Reads the account first, so it acts on what
 * is there now, and again afterwards, so the page shows the result. One campaign, or all.
 */
export async function reconcileAccount(
  db: Db,
  provider: AdsProvider,
  campaignId?: string,
): Promise<{ ok: true; fixed: number; failed: number; left: number } | { ok: false; error: string }> {
  const before = await checkAccount(db, provider);
  if (!before.ok) return before;
  const expected = new Map((await expectedCampaigns(db)).map((e) => [e.id, e]));
  let fixed = 0;
  let failed = 0;
  for (const c of before.drift.campaigns) {
    if (campaignId && c.id !== campaignId) continue;
    if (!fixable(c.issues, c.kind)) continue;
    const e = expected.get(c.id)!;
    const has = (k: string) => c.issues.some((i) => i.kind === k);
    let ok = true;
    if (has("shared_budget") || has("bidding") || has("cpc_cap")) {
      const r = await send(db, provider, {
        op: "restore_search",
        campaign: e.resource,
        name: e.name,
        budgetCents: e.budgetCents,
        cpcCapCents: e.cpcCapCents,
      });
      ok = r.ok;
      if (r.ok && r.budget)
        await db.update(adCampaigns).set({ budgetGoogleId: r.budget }).where(eq(adCampaigns.id, c.id));
    } else if (has("budget") && e.budget) {
      ok = (await send(db, provider, { op: "set_budget", budget: e.budget, cents: e.budgetCents })).ok;
    }
    if (ok && has("status"))
      ok = (await send(db, provider, { op: "set_campaign_status", campaign: e.resource, status: e.status }))
        .ok;
    if (ok) fixed++;
    else failed++;
  }
  const after = await checkAccount(db, provider);
  if (!after.ok) return after;
  return { ok: true, fixed, failed, left: after.drift.campaigns.length };
}

/**
 * Pauses a campaign Trilio did not create. Only one the last check listed as foreign and
 * running: the form's value is never trusted as a campaign to change.
 */
export async function pauseForeignCampaign(
  db: Db,
  provider: AdsProvider,
  resource: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const control = await accountControl(db);
  const target = control?.drift.foreign.find((f) => f.resource === resource && f.status === "enabled");
  if (!target) return { ok: false, error: "not_found" };
  const r = await send(db, provider, { op: "set_campaign_status", campaign: resource, status: "paused" });
  if (!r.ok) return { ok: false, error: r.error };
  await checkAccount(db, provider);
  return { ok: true };
}
